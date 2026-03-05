/**
 * Patterns module — context graph for tiny-mcp-server.
 * Builds a queryable graph of nodes, edges, and notes.
 * Depends on Recall for persistence.
 */
import type { ModuleMetadata, ModuleContext } from "../mcp";
import type { RecallAPI } from "./recall";

export interface PatternsNode {
  id: string;
  type: string;
  name: string;
  boost?: number;
  metadata?: Record<string, unknown>;
}

export type Direction = "outgoing" | "incoming" | "both";

export interface PatternsEdge {
  from: string;
  to: string;
  relationship: string;
  metadata?: Record<string, unknown>;
}

export interface TraverseResult {
  nodes: PatternsNode[];
  edges: PatternsEdge[];
  depth: number;
}

export interface PathResult {
  nodes: PatternsNode[];
  edges: PatternsEdge[];
  length: number;
}

export interface PatternsAPI {
  addNode(id: string, type: string, name: string, metadata?: Record<string, unknown>): void;
  addEdge(from: string, to: string, relationship: string, metadata?: Record<string, unknown>): void;
  getNode(id: string): PatternsNode | null;
  getEdges(nodeId: string): PatternsEdge[];
  query(opts: { type?: string; relationship?: string; nodeId?: string }): unknown[];
  addNote(entity: string, note: string): void;
  getNotes(entity: string): { text: string; timestamp: number }[];
  setBoost(id: string, boost: number): void;
  neighbors(id: string, opts?: { direction?: Direction; relationship?: string }): PatternsNode[];
  traverse(startId: string, opts?: { direction?: Direction; relationship?: string; maxDepth?: number; mode?: "bfs" | "dfs" }): TraverseResult;
  shortestPath(fromId: string, toId: string, opts?: { direction?: Direction; relationship?: string }): PathResult | null;
  allEdges(): PatternsEdge[];
}

export default function patterns() {
  return {
    name: "patterns",
    depends: ["recall"],

    init(ctx: ModuleContext) {
      const recall = ctx.recall as RecallAPI;
      if (!recall) throw new Error("Patterns requires Recall module");

      const db = recall.db();

      db.exec(`
        CREATE TABLE IF NOT EXISTS patterns_nodes (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          name TEXT NOT NULL,
          boost REAL NOT NULL DEFAULT 0,
          metadata TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_nodes_type ON patterns_nodes(type);

        CREATE TABLE IF NOT EXISTS patterns_edges (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          src TEXT NOT NULL,
          dst TEXT NOT NULL,
          relationship TEXT NOT NULL,
          metadata TEXT,
          UNIQUE(src, dst, relationship)
        );
        CREATE INDEX IF NOT EXISTS idx_edges_src ON patterns_edges(src);
        CREATE INDEX IF NOT EXISTS idx_edges_dst ON patterns_edges(dst);
        CREATE INDEX IF NOT EXISTS idx_edges_rel ON patterns_edges(relationship);

        CREATE TABLE IF NOT EXISTS patterns_notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          entity TEXT NOT NULL,
          text TEXT NOT NULL,
          timestamp INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_notes_entity ON patterns_notes(entity);
      `);

      const stmts = {
        upsertNode: db.prepare(`INSERT INTO patterns_nodes (id, type, name, metadata) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET type = excluded.type, name = excluded.name, metadata = excluded.metadata`),
        getNode: db.prepare(`SELECT id, type, name, boost, metadata FROM patterns_nodes WHERE id = ?`),
        nodesByType: db.prepare(`SELECT id, type, name, boost, metadata FROM patterns_nodes WHERE type = ?`),
        allNodes: db.prepare(`SELECT id, type, name, boost, metadata FROM patterns_nodes`),
        setBoost: db.prepare(`UPDATE patterns_nodes SET boost = ? WHERE id = ?`),
        upsertEdge: db.prepare(`INSERT INTO patterns_edges (src, dst, relationship, metadata) VALUES (?, ?, ?, ?) ON CONFLICT(src, dst, relationship) DO UPDATE SET metadata = excluded.metadata`),
        edgesBySrc: db.prepare(`SELECT src, dst, relationship, metadata FROM patterns_edges WHERE src = ?`),
        edgesByDst: db.prepare(`SELECT src, dst, relationship, metadata FROM patterns_edges WHERE dst = ?`),
        edgesByRel: db.prepare(`SELECT src, dst, relationship, metadata FROM patterns_edges WHERE relationship = ?`),
        edgesBySrcAndRel: db.prepare(`SELECT src, dst, relationship, metadata FROM patterns_edges WHERE src = ? AND relationship = ?`),
        edgesByDstAndRel: db.prepare(`SELECT src, dst, relationship, metadata FROM patterns_edges WHERE dst = ? AND relationship = ?`),
        dstBySrcAndRel: db.prepare(`SELECT dst FROM patterns_edges WHERE src = ? AND relationship = ?`),
        srcByDstAndRel: db.prepare(`SELECT src FROM patterns_edges WHERE dst = ? AND relationship = ?`),
        insertNote: db.prepare(`INSERT INTO patterns_notes (entity, text, timestamp) VALUES (?, ?, ?)`),
        notesByEntity: db.prepare(`SELECT text, timestamp FROM patterns_notes WHERE entity = ? ORDER BY timestamp ASC`),
        allEdges: db.prepare(`SELECT src, dst, relationship, metadata FROM patterns_edges`),
      };

      function parseNode(row: { id: string; type: string; name: string; boost: number; metadata: string | null }): PatternsNode {
        return { id: row.id, type: row.type, name: row.name, boost: row.boost || undefined, metadata: row.metadata ? JSON.parse(row.metadata) : undefined };
      }

      function parseEdge(row: { src: string; dst: string; relationship: string; metadata: string | null }) {
        return { from: row.src, to: row.dst, relationship: row.relationship, metadata: row.metadata ? JSON.parse(row.metadata) : undefined };
      }

      const api: PatternsAPI = {
        addNode(id, type, name, metadata) {
          stmts.upsertNode.run(id, type, name, metadata ? JSON.stringify(metadata) : null);
          ctx.emit?.("patterns:nodeAdded", { id, type, name, metadata });
        },

        addEdge(from, to, relationship, metadata) {
          stmts.upsertEdge.run(from, to, relationship, metadata ? JSON.stringify(metadata) : null);
          ctx.emit?.("patterns:edgeAdded", { from, to, relationship, metadata });
        },

        getNode(id) {
          const row = stmts.getNode.get(id) as { id: string; type: string; name: string; metadata: string | null } | null;
          return row ? parseNode(row) : null;
        },

        getEdges(nodeId) {
          const outgoing = stmts.edgesBySrc.all(nodeId) as { src: string; dst: string; relationship: string; metadata: string | null }[];
          const incoming = stmts.edgesByDst.all(nodeId) as { src: string; dst: string; relationship: string; metadata: string | null }[];
          return [...outgoing, ...incoming].map(parseEdge);
        },

        query(opts) {
          if (opts.nodeId) {
            const node = api.getNode(opts.nodeId);
            const edgeList = api.getEdges(opts.nodeId);
            const noteList = api.getNotes(opts.nodeId);
            return [{ node, edges: edgeList, notes: noteList }];
          }
          if (opts.type) {
            return (stmts.nodesByType.all(opts.type) as any[]).map(parseNode);
          }
          if (opts.relationship) {
            return (stmts.edgesByRel.all(opts.relationship) as any[]).map(parseEdge);
          }
          return (stmts.allNodes.all() as any[]).map(parseNode);
        },

        addNote(entity, note) {
          stmts.insertNote.run(entity, note, Date.now());
          ctx.emit?.("patterns:noteAdded", { entity, note });
        },

        getNotes(entity) {
          return stmts.notesByEntity.all(entity) as { text: string; timestamp: number }[];
        },

        setBoost(id, boost) {
          stmts.setBoost.run(boost, id);
        },

        allEdges() {
          return (stmts.allEdges.all() as any[]).map(parseEdge);
        },

        neighbors(id, opts = {}) {
          const dir = opts.direction || "both";
          const rel = opts.relationship;
          const ids = new Set<string>();

          if (dir === "outgoing" || dir === "both") {
            const rows = (rel
              ? stmts.dstBySrcAndRel.all(id, rel)
              : stmts.edgesBySrc.all(id)) as any[];
            for (const r of rows) ids.add(r.dst);
          }
          if (dir === "incoming" || dir === "both") {
            const rows = (rel
              ? stmts.srcByDstAndRel.all(id, rel)
              : stmts.edgesByDst.all(id)) as any[];
            for (const r of rows) ids.add(r.src);
          }

          return [...ids].map(nid => api.getNode(nid)).filter(Boolean) as PatternsNode[];
        },

        traverse(startId, opts = {}) {
          const dir = opts.direction || "outgoing";
          const rel = opts.relationship;
          const maxDepth = opts.maxDepth ?? 10;
          const mode = opts.mode || "bfs";

          const visited = new Set<string>();
          const nodeMap = new Map<string, PatternsNode>();
          const edgeList: PatternsEdge[] = [];
          let deepest = 0;

          function getEdgesDirectional(nodeId: string): { src: string; dst: string; relationship: string; metadata: string | null }[] {
            const results: any[] = [];
            if (dir === "outgoing" || dir === "both") {
              const rows = rel
                ? stmts.edgesBySrcAndRel.all(nodeId, rel)
                : stmts.edgesBySrc.all(nodeId);
              results.push(...(rows as any[]));
            }
            if (dir === "incoming" || dir === "both") {
              const rows = rel
                ? stmts.edgesByDstAndRel.all(nodeId, rel)
                : stmts.edgesByDst.all(nodeId);
              results.push(...(rows as any[]));
            }
            return results;
          }

          // BFS or DFS
          const frontier: { id: string; depth: number }[] = [{ id: startId, depth: 0 }];
          visited.add(startId);
          const startNode = api.getNode(startId);
          if (startNode) nodeMap.set(startId, startNode);

          while (frontier.length > 0) {
            const current = mode === "bfs" ? frontier.shift()! : frontier.pop()!;
            if (current.depth > deepest) deepest = current.depth;
            if (current.depth >= maxDepth) continue;

            const edges = getEdgesDirectional(current.id);
            for (const row of edges) {
              const edge = parseEdge(row);
              edgeList.push(edge);
              const neighborId = row.src === current.id ? row.dst : row.src;
              if (!visited.has(neighborId)) {
                visited.add(neighborId);
                const node = api.getNode(neighborId);
                if (node) nodeMap.set(neighborId, node);
                frontier.push({ id: neighborId, depth: current.depth + 1 });
              }
            }
          }

          return { nodes: [...nodeMap.values()], edges: edgeList, depth: deepest };
        },

        shortestPath(fromId, toId, opts = {}) {
          const dir = opts.direction || "both";
          const rel = opts.relationship;

          const visited = new Set<string>();
          const parent = new Map<string, { nodeId: string; edge: PatternsEdge }>();
          const queue: string[] = [fromId];
          visited.add(fromId);

          while (queue.length > 0) {
            const current = queue.shift()!;
            if (current === toId) {
              // Reconstruct path
              const pathNodes: PatternsNode[] = [];
              const pathEdges: PatternsEdge[] = [];
              let cursor = toId;
              while (cursor !== fromId) {
                const p = parent.get(cursor)!;
                const node = api.getNode(cursor);
                if (node) pathNodes.unshift(node);
                pathEdges.unshift(p.edge);
                cursor = p.nodeId;
              }
              const startNode = api.getNode(fromId);
              if (startNode) pathNodes.unshift(startNode);
              return { nodes: pathNodes, edges: pathEdges, length: pathEdges.length };
            }

            // Expand neighbors
            const edges: any[] = [];
            if (dir === "outgoing" || dir === "both") {
              const rows = rel
                ? stmts.edgesBySrcAndRel.all(current, rel)
                : stmts.edgesBySrc.all(current);
              edges.push(...(rows as any[]));
            }
            if (dir === "incoming" || dir === "both") {
              const rows = rel
                ? stmts.edgesByDstAndRel.all(current, rel)
                : stmts.edgesByDst.all(current);
              edges.push(...(rows as any[]));
            }

            for (const row of edges) {
              const neighborId = row.src === current ? row.dst : row.src;
              if (!visited.has(neighborId)) {
                visited.add(neighborId);
                parent.set(neighborId, { nodeId: current, edge: parseEdge(row) });
                queue.push(neighborId);
              }
            }
          }

          return null; // No path found
        },
      };

      ctx.patterns = api;

      ctx.registerTool(
        "patterns_add_node",
        "Add a node to the context graph",
        {
          type: "object",
          required: ["id", "type", "name"],
          properties: {
            id: { type: "string", description: "Unique node identifier" },
            type: { type: "string", description: "Node type (e.g. file, function, class, module)" },
            name: { type: "string", description: "Human-readable name" },
            metadata: { type: "object", description: "Optional metadata" },
          },
        },
        async ({ id, type, name, metadata }) => {
          api.addNode(id as string, type as string, name as string, metadata as Record<string, unknown>);
          return { ok: true };
        }
      );

      ctx.registerTool(
        "patterns_add_edge",
        "Add a relationship edge between two nodes",
        {
          type: "object",
          required: ["from", "to", "relationship"],
          properties: {
            from: { type: "string", description: "Source node ID" },
            to: { type: "string", description: "Target node ID" },
            relationship: { type: "string", description: "Relationship type (e.g. imports, extends, calls)" },
            metadata: { type: "object", description: "Optional metadata" },
          },
        },
        async ({ from, to, relationship, metadata }) => {
          api.addEdge(from as string, to as string, relationship as string, metadata as Record<string, unknown>);
          return { ok: true };
        }
      );

      ctx.registerTool(
        "patterns_query",
        "Query the context graph by type, relationship, or node ID",
        {
          type: "object",
          properties: {
            type: { type: "string", description: "Filter nodes by type" },
            relationship: { type: "string", description: "Filter edges by relationship" },
            nodeId: { type: "string", description: "Get full context for a specific node" },
          },
        },
        async ({ type, relationship, nodeId }) => {
          const results = api.query({
            type: type as string | undefined,
            relationship: relationship as string | undefined,
            nodeId: nodeId as string | undefined,
          });
          return { results, count: results.length };
        }
      );

      ctx.registerTool(
        "patterns_add_note",
        "Attach a note to an entity in the graph",
        {
          type: "object",
          required: ["entity", "note"],
          properties: {
            entity: { type: "string", description: "Entity ID to attach note to" },
            note: { type: "string", description: "Note text" },
          },
        },
        async ({ entity, note }) => {
          api.addNote(entity as string, note as string);
          return { ok: true };
        }
      );

      ctx.registerTool(
        "patterns_neighbors",
        "Get directly connected nodes. Filter by direction and relationship type.",
        {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", description: "Node ID to get neighbors of" },
            direction: { type: "string", enum: ["outgoing", "incoming", "both"], description: "Edge direction (default: both)" },
            relationship: { type: "string", description: "Filter by relationship type" },
          },
        },
        async ({ id, direction, relationship }) => {
          const nodes = api.neighbors(id as string, {
            direction: (direction as Direction) || undefined,
            relationship: relationship as string | undefined,
          });
          return { nodes, count: nodes.length };
        }
      );

      ctx.registerTool(
        "patterns_traverse",
        "Walk the graph from a starting node via BFS or DFS. Returns all reachable nodes and edges within depth limit.",
        {
          type: "object",
          required: ["startId"],
          properties: {
            startId: { type: "string", description: "Node ID to start traversal from" },
            direction: { type: "string", enum: ["outgoing", "incoming", "both"], description: "Edge direction (default: outgoing)" },
            relationship: { type: "string", description: "Filter by relationship type" },
            maxDepth: { type: "integer", minimum: 1, maximum: 50, description: "Max traversal depth (default: 10)" },
            mode: { type: "string", enum: ["bfs", "dfs"], description: "Traversal mode (default: bfs)" },
          },
        },
        async ({ startId, direction, relationship, maxDepth, mode }) => {
          return api.traverse(startId as string, {
            direction: (direction as Direction) || undefined,
            relationship: relationship as string | undefined,
            maxDepth: maxDepth as number | undefined,
            mode: (mode as "bfs" | "dfs") || undefined,
          });
        }
      );

      ctx.registerTool(
        "patterns_shortest_path",
        "Find the shortest path between two nodes in the graph.",
        {
          type: "object",
          required: ["fromId", "toId"],
          properties: {
            fromId: { type: "string", description: "Starting node ID" },
            toId: { type: "string", description: "Target node ID" },
            direction: { type: "string", enum: ["outgoing", "incoming", "both"], description: "Edge direction (default: both)" },
            relationship: { type: "string", description: "Filter by relationship type" },
          },
        },
        async ({ fromId, toId, direction, relationship }) => {
          const path = api.shortestPath(fromId as string, toId as string, {
            direction: (direction as Direction) || undefined,
            relationship: relationship as string | undefined,
          });
          return path || { nodes: [], edges: [], length: -1 };
        }
      );
    },
  } satisfies ModuleMetadata;
}
