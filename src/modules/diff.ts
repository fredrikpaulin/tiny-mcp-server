/**
 * Diff module — compares graph snapshots to detect added, removed, and changed
 * nodes and edges between scans. Uses Recall to store snapshots.
 * Depends on Patterns, Recall, and Export.
 */
import type { ModuleMetadata, ModuleContext } from "../mcp";
import type { RecallAPI } from "./recall";
import type { ExportAPI } from "./export";
import type { PatternsNode, PatternsEdge } from "./patterns";

interface Snapshot {
  nodes: PatternsNode[];
  edges: PatternsEdge[];
  timestamp: number;
}

export interface DiffResult {
  nodes: { added: string[]; removed: string[]; changed: string[] };
  edges: { added: string[]; removed: string[] };
  summary: { nodesAdded: number; nodesRemoved: number; nodesChanged: number; edgesAdded: number; edgesRemoved: number };
}

export interface DiffAPI {
  snapshot(name?: string): Snapshot;
  compare(name?: string): DiffResult;
  listSnapshots(): string[];
}

function edgeKey(e: { from: string; to: string; relationship: string }) {
  return `${e.from} -[${e.relationship}]-> ${e.to}`;
}

function nodeFingerprint(n: PatternsNode) {
  return JSON.stringify({ type: n.type, name: n.name, metadata: n.metadata || {} });
}

export default function diff() {
  return {
    name: "diff",
    depends: ["recall", "patterns", "export"],

    init(ctx: ModuleContext) {
      const recall = ctx.recall as RecallAPI;
      const exportApi = ctx.export as ExportAPI;
      if (!recall || !exportApi) throw new Error("Diff requires Recall and Export modules");

      const store = recall.namespace("diff");

      function snapshot(name = "latest"): Snapshot {
        const { nodes, edges } = exportApi.toJSON({ includeMetadata: true });
        const snap: Snapshot = { nodes, edges, timestamp: Date.now() };
        store.set(`snap:${name}`, snap);
        return snap;
      }

      function compare(name = "latest"): DiffResult {
        const prev = store.get(`snap:${name}`) as Snapshot | null;
        const current = exportApi.toJSON({ includeMetadata: true });

        if (!prev) {
          // No previous snapshot — everything is "added"
          return {
            nodes: { added: current.nodes.map(n => n.id), removed: [], changed: [] },
            edges: { added: current.edges.map(edgeKey), removed: [] },
            summary: {
              nodesAdded: current.nodes.length, nodesRemoved: 0, nodesChanged: 0,
              edgesAdded: current.edges.length, edgesRemoved: 0,
            },
          };
        }

        // Build maps for comparison
        const prevNodes = new Map(prev.nodes.map(n => [n.id, n]));
        const currNodes = new Map(current.nodes.map(n => [n.id, n]));
        const prevEdges = new Set(prev.edges.map(edgeKey));
        const currEdges = new Set(current.edges.map(edgeKey));

        const added: string[] = [];
        const removed: string[] = [];
        const changed: string[] = [];

        for (const [id, node] of currNodes) {
          const prev = prevNodes.get(id);
          if (!prev) { added.push(id); continue; }
          if (nodeFingerprint(node) !== nodeFingerprint(prev)) changed.push(id);
        }
        for (const id of prevNodes.keys()) {
          if (!currNodes.has(id)) removed.push(id);
        }

        const edgesAdded: string[] = [];
        const edgesRemoved: string[] = [];
        for (const key of currEdges) { if (!prevEdges.has(key)) edgesAdded.push(key); }
        for (const key of prevEdges) { if (!currEdges.has(key)) edgesRemoved.push(key); }

        return {
          nodes: { added, removed, changed },
          edges: { added: edgesAdded, removed: edgesRemoved },
          summary: {
            nodesAdded: added.length, nodesRemoved: removed.length, nodesChanged: changed.length,
            edgesAdded: edgesAdded.length, edgesRemoved: edgesRemoved.length,
          },
        };
      }

      function listSnapshots(): string[] {
        return store.query("snap:%").map(([key]) => (key as string).replace("snap:", ""));
      }

      const api: DiffAPI = { snapshot, compare, listSnapshots };
      ctx.diff = api;

      ctx.registerTool(
        "graph_snapshot",
        "Take a snapshot of the current graph state for later comparison.",
        {
          type: "object",
          properties: {
            name: { type: "string", description: "Snapshot name (default: 'latest')" },
          },
        },
        async ({ name }) => {
          const snap = snapshot(name as string || "latest");
          return { ok: true, name: name || "latest", nodes: snap.nodes.length, edges: snap.edges.length, timestamp: snap.timestamp };
        }
      );

      ctx.registerTool(
        "graph_diff",
        "Compare the current graph against a stored snapshot. Shows added, removed, and changed nodes/edges.",
        {
          type: "object",
          properties: {
            name: { type: "string", description: "Snapshot name to compare against (default: 'latest')" },
          },
        },
        async ({ name }) => {
          return compare(name as string || "latest");
        }
      );

      ctx.registerTool(
        "graph_snapshots",
        "List all stored graph snapshots.",
        { type: "object", properties: {} },
        async () => ({ snapshots: listSnapshots() })
      );
    },
  } satisfies ModuleMetadata;
}
