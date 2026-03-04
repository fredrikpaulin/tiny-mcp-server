/**
 * Patterns module — context graph for tiny-mcp-server.
 * Builds a queryable graph of nodes, edges, and notes.
 * Depends on Recall for persistence.
 */
import type { ModuleMetadata, ModuleContext } from "../mcp";
import type { RecallAPI } from "./recall";

export interface PatternsAPI {
  addNode(id: string, type: string, name: string, metadata?: Record<string, unknown>): void;
  addEdge(from: string, to: string, relationship: string, metadata?: Record<string, unknown>): void;
  getNode(id: string): { id: string; type: string; name: string; metadata?: Record<string, unknown> } | null;
  getEdges(nodeId: string): { from: string; to: string; relationship: string; metadata?: Record<string, unknown> }[];
  query(opts: { type?: string; relationship?: string; nodeId?: string }): unknown[];
  addNote(entity: string, note: string): void;
  getNotes(entity: string): { text: string; timestamp: number }[];
}

export default function patterns() {
  return {
    name: "patterns",
    depends: ["recall"],

    init(ctx: ModuleContext) {
      const recall = ctx.recall as RecallAPI;
      if (!recall) throw new Error("Patterns requires Recall module");

      const api: PatternsAPI = {
        addNode(id, type, name, metadata) {
          recall.set(`patterns:node:${id}`, { id, type, name, metadata });
        },

        addEdge(from, to, relationship, metadata) {
          const edgeId = `${from}:${to}:${relationship}`;
          recall.set(`patterns:edge:${edgeId}`, { from, to, relationship, metadata });
        },

        getNode(id) {
          return recall.get(`patterns:node:${id}`) as ReturnType<PatternsAPI["getNode"]>;
        },

        getEdges(nodeId) {
          const outgoing = recall.query(`patterns:edge:${nodeId}:%`);
          const incoming = recall.query(`patterns:edge:%:${nodeId}:%`);
          return [...outgoing, ...incoming].map(([, v]) => v as ReturnType<PatternsAPI["getEdges"]>[0]);
        },

        query(opts) {
          if (opts.nodeId) {
            const node = api.getNode(opts.nodeId);
            const edges = api.getEdges(opts.nodeId);
            const notes = api.getNotes(opts.nodeId);
            return [{ node, edges, notes }];
          }
          if (opts.type) {
            const all = recall.query("patterns:node:%");
            return all.filter(([, v]) => (v as { type: string }).type === opts.type).map(([, v]) => v);
          }
          if (opts.relationship) {
            const all = recall.query("patterns:edge:%");
            return all.filter(([, v]) => (v as { relationship: string }).relationship === opts.relationship).map(([, v]) => v);
          }
          return recall.query("patterns:node:%").map(([, v]) => v);
        },

        addNote(entity, note) {
          const key = `patterns:note:${entity}`;
          const existing = (recall.get(key) as { text: string; timestamp: number }[]) || [];
          existing.push({ text: note, timestamp: Date.now() });
          recall.set(key, existing);
        },

        getNotes(entity) {
          return (recall.get(`patterns:note:${entity}`) as { text: string; timestamp: number }[]) || [];
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
    },
  } satisfies ModuleMetadata;
}
