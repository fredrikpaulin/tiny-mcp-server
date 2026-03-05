/**
 * Refactor module — find all references to a symbol across the graph
 * and trace rename impact. Uses Patterns edges (defines, exports, calls,
 * imports, extends, implements, has_method) to locate every usage.
 * Depends on Patterns.
 */
import type { ModuleMetadata, ModuleContext } from "../mcp";
import type { PatternsAPI, PatternsNode, PatternsEdge } from "./patterns";

export interface Reference {
  nodeId: string;
  type: string;
  name: string;
  relationship: string;
  file?: string;
  line?: number;
}

export interface FindRefsResult {
  symbol: string;
  definition: Reference | null;
  references: Reference[];
  count: number;
}

export interface RenameImpact {
  symbol: string;
  newName: string;
  affected: { file: string; nodeId: string; relationship: string }[];
  count: number;
}

export interface RefactorAPI {
  findRefs(symbol: string): FindRefsResult;
  renameImpact(symbol: string, newName: string): RenameImpact;
}

function fileFromNodeId(id: string): string | undefined {
  const colon = id.indexOf(":");
  return colon > 0 ? id.slice(0, colon) : undefined;
}

export default function refactor() {
  return {
    name: "refactor",
    depends: ["patterns"],

    init(ctx: ModuleContext) {
      const patterns = ctx.patterns as PatternsAPI;
      if (!patterns) throw new Error("Refactor requires Patterns module");

      function findRefs(symbol: string): FindRefsResult {
        // Find the node — try exact match first, then suffix match (name without file prefix)
        let node = patterns.getNode(symbol);
        if (!node) {
          const all = patterns.query({}) as PatternsNode[];
          node = all.find(n => n.name === symbol) || null;
        }
        if (!node) {
          return { symbol, definition: null, references: [], count: 0 };
        }

        const nodeId = node.id;
        const edges = patterns.allEdges();
        const refs: Reference[] = [];
        let definition: Reference | null = null;

        for (const e of edges) {
          // This node is the target (something points TO it)
          if (e.to === nodeId) {
            const srcNode = patterns.getNode(e.from);
            if (!srcNode) continue;

            if (e.relationship === "defines") {
              definition = {
                nodeId: e.from,
                type: srcNode.type,
                name: srcNode.name,
                relationship: "defines",
                file: srcNode.type === "file" ? srcNode.name : fileFromNodeId(e.from),
                line: (node.metadata as any)?.line,
              };
            } else {
              refs.push({
                nodeId: e.from,
                type: srcNode.type,
                name: srcNode.name,
                relationship: e.relationship,
                file: srcNode.type === "file" ? srcNode.name : fileFromNodeId(e.from),
                line: (srcNode.metadata as any)?.line,
              });
            }
          }

          // This node is the source (it points TO something)
          if (e.from === nodeId) {
            const dstNode = patterns.getNode(e.to);
            if (!dstNode) continue;

            // Skip the "defines" edge from file→symbol (already captured above)
            if (e.relationship === "defines" || e.relationship === "exports") continue;

            refs.push({
              nodeId: e.to,
              type: dstNode.type,
              name: dstNode.name,
              relationship: e.relationship,
              file: dstNode.type === "file" ? dstNode.name : fileFromNodeId(e.to),
              line: (dstNode.metadata as any)?.line,
            });
          }
        }

        // Also find imports that reference this symbol by specifier name
        for (const e of edges) {
          if (e.relationship !== "imports") continue;
          const meta = e.metadata as any;
          const specifiers = meta?.specifiers as string[] | undefined;
          if (!specifiers?.includes(node.name)) continue;

          const srcNode = patterns.getNode(e.from);
          if (srcNode && !refs.some(r => r.nodeId === e.from && r.relationship === "imports")) {
            refs.push({
              nodeId: e.from,
              type: srcNode.type,
              name: srcNode.name,
              relationship: "imports",
              file: srcNode.type === "file" ? srcNode.name : fileFromNodeId(e.from),
            });
          }
        }

        return { symbol: nodeId, definition, references: refs, count: refs.length };
      }

      function renameImpact(symbol: string, newName: string): RenameImpact {
        const result = findRefs(symbol);
        const affected: { file: string; nodeId: string; relationship: string }[] = [];

        if (result.definition) {
          affected.push({
            file: result.definition.file || "unknown",
            nodeId: result.definition.nodeId,
            relationship: "definition",
          });
        }

        for (const ref of result.references) {
          affected.push({
            file: ref.file || "unknown",
            nodeId: ref.nodeId,
            relationship: ref.relationship,
          });
        }

        return { symbol: result.symbol, newName, affected, count: affected.length };
      }

      const api: RefactorAPI = { findRefs, renameImpact };
      ctx.refactor = api;

      ctx.registerTool(
        "refactor_refs",
        "Find all references to a symbol across the codebase graph. Returns the definition location and all call sites, imports, extends, and implements references.",
        {
          type: "object",
          required: ["symbol"],
          properties: {
            symbol: { type: "string", description: "Symbol name or full node ID (e.g. 'validate' or 'utils/validate.ts:validate')" },
          },
        },
        async ({ symbol }) => findRefs(symbol as string)
      );

      ctx.registerTool(
        "refactor_rename_impact",
        "Preview the impact of renaming a symbol. Shows all files and nodes that would need updating.",
        {
          type: "object",
          required: ["symbol", "newName"],
          properties: {
            symbol: { type: "string", description: "Symbol to rename" },
            newName: { type: "string", description: "Proposed new name" },
          },
        },
        async ({ symbol, newName }) => renameImpact(symbol as string, newName as string)
      );
    },
  } satisfies ModuleMetadata;
}
