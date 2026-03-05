/**
 * Export module — dumps the Patterns graph as DOT (Graphviz) or JSON.
 * Supports filtering by node type, relationship, and proximity.
 * Depends on Patterns.
 */
import type { ModuleMetadata, ModuleContext } from "../mcp";
import type { PatternsAPI, PatternsNode, PatternsEdge, Direction } from "./patterns";

export interface ExportOptions {
  format: "dot" | "json";
  type?: string;
  relationship?: string;
  near?: { node: string; maxDepth?: number; direction?: Direction };
  includeMetadata?: boolean;
}

export interface ExportAPI {
  toDot(opts?: Omit<ExportOptions, "format">): string;
  toJSON(opts?: Omit<ExportOptions, "format">): { nodes: PatternsNode[]; edges: PatternsEdge[] };
}

const SHAPES: Record<string, string> = {
  file: "folder", function: "ellipse", class: "component",
  interface: "diamond", type: "note", variable: "box",
};

function dotEscape(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function shapeFor(node: PatternsNode) {
  if (node.id.startsWith("effect:")) return "octagon";
  return SHAPES[node.type] || "box";
}

function metaLabel(meta: Record<string, unknown> | undefined) {
  if (!meta) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) parts.push(`${k}=[${v.length}]`);
    else if (typeof v === "object") continue;
    else parts.push(`${k}=${v}`);
  }
  return parts.length ? `\\n${parts.join(", ")}` : "";
}

export default function graphExport() {
  return {
    name: "export",
    depends: ["patterns"],

    init(ctx: ModuleContext) {
      const patterns = ctx.patterns as PatternsAPI;
      if (!patterns) throw new Error("Export requires Patterns module");

      function gather(opts: Omit<ExportOptions, "format"> = {}) {
        let nodes: PatternsNode[];
        let edges: PatternsEdge[];

        if (opts.near) {
          const { node, maxDepth = 3, direction = "both" } = opts.near;
          const result = patterns.traverse(node, { direction, maxDepth });
          nodes = result.nodes;
          // Get edges between traversed nodes
          const nodeIds = new Set(nodes.map(n => n.id));
          edges = patterns.allEdges().filter(e => nodeIds.has(e.from) || nodeIds.has(e.to));
        } else {
          nodes = patterns.query({}) as PatternsNode[];
          edges = patterns.allEdges();
        }

        if (opts.type) {
          nodes = nodes.filter(n => n.type === opts.type);
          const nodeIds = new Set(nodes.map(n => n.id));
          edges = edges.filter(e => nodeIds.has(e.from) || nodeIds.has(e.to));
        }

        if (opts.relationship) {
          edges = edges.filter(e => e.relationship === opts.relationship);
          // Keep only nodes referenced by filtered edges
          const referenced = new Set<string>();
          for (const e of edges) { referenced.add(e.from); referenced.add(e.to); }
          nodes = nodes.filter(n => referenced.has(n.id));
        }

        return { nodes, edges };
      }

      function toDot(opts: Omit<ExportOptions, "format"> = {}): string {
        const { nodes, edges } = gather(opts);
        const showMeta = opts.includeMetadata ?? false;
        const lines: string[] = [
          "digraph G {",
          '  rankdir=LR;',
          '  node [shape=box, fontname="Helvetica", fontsize=10];',
          '  edge [fontname="Helvetica", fontsize=8];',
          "",
        ];

        for (const n of nodes) {
          const shape = shapeFor(n);
          const label = dotEscape(n.name) + (showMeta ? dotEscape(metaLabel(n.metadata as Record<string, unknown>)) : "");
          lines.push(`  "${dotEscape(n.id)}" [shape=${shape}, label="${label}"];`);
        }

        lines.push("");
        for (const e of edges) {
          lines.push(`  "${dotEscape(e.from)}" -> "${dotEscape(e.to)}" [label="${dotEscape(e.relationship)}"];`);
        }

        lines.push("}");
        return lines.join("\n");
      }

      function toJSON(opts: Omit<ExportOptions, "format"> = {}) {
        const { nodes, edges } = gather(opts);
        const showMeta = opts.includeMetadata ?? true;
        return {
          nodes: nodes.map(n => showMeta ? n : { id: n.id, type: n.type, name: n.name }),
          edges: edges.map(e => showMeta ? e : { from: e.from, to: e.to, relationship: e.relationship }),
        };
      }

      const api: ExportAPI = { toDot, toJSON };
      ctx.export = api;

      ctx.registerTool(
        "graph_export",
        "Export the context graph as DOT (Graphviz) or JSON. Optionally filter by node type, relationship, or proximity to a node.",
        {
          type: "object",
          required: ["format"],
          properties: {
            format: { type: "string", enum: ["dot", "json"], description: "Output format" },
            type: { type: "string", description: "Filter to specific node type" },
            relationship: { type: "string", description: "Filter to specific edge type" },
            near: {
              type: "object",
              description: "Export subgraph near a node",
              properties: {
                node: { type: "string", description: "Center node ID" },
                maxDepth: { type: "number", description: "Max distance (default 3)" },
                direction: { type: "string", enum: ["outgoing", "incoming", "both"] },
              },
              required: ["node"],
            },
            includeMetadata: { type: "boolean", description: "Include metadata (default: false for DOT, true for JSON)" },
          },
        },
        async (args) => {
          const opts = {
            type: args.type as string | undefined,
            relationship: args.relationship as string | undefined,
            near: args.near as ExportOptions["near"],
            includeMetadata: args.includeMetadata as boolean | undefined,
          };
          if (args.format === "dot") return { format: "dot", output: toDot(opts) };
          return { format: "json", ...toJSON(opts) };
        }
      );
    },
  } satisfies ModuleMetadata;
}
