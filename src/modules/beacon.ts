/**
 * Beacon module — fast context search for tiny-mcp-server.
 * Searches across Recall data and Patterns graph.
 * Depends on Recall and Patterns.
 */
import type { ModuleMetadata, ModuleContext } from "../mcp";
import type { RecallAPI } from "./recall";
import type { PatternsAPI } from "./patterns";

export interface BeaconResult {
  type: string;
  key: string;
  value: unknown;
  score: number;
}

export interface BeaconAPI {
  search(query: string, opts?: { maxResults?: number; types?: string[] }): BeaconResult[];
}

function score(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t === q) return 1;
  if (t.startsWith(q)) return 0.8;
  if (t.includes(q)) return 0.5 + (q.length / t.length) * 0.3;
  return 0;
}

export default function beacon(config: { maxResults?: number } = {}) {
  const maxDefault = config.maxResults || 20;

  return {
    name: "beacon",
    depends: ["recall", "patterns"],

    init(ctx: ModuleContext) {
      const recall = ctx.recall as RecallAPI;
      const patterns = ctx.patterns as PatternsAPI;
      if (!recall || !patterns) throw new Error("Beacon requires Recall and Patterns modules");

      const api: BeaconAPI = {
        search(query, opts) {
          const max = opts?.maxResults || maxDefault;
          const types = opts?.types;
          const results: BeaconResult[] = [];
          const q = query.toLowerCase();

          // Search recall keys
          const recallRows = recall.query(`%${query}%`);
          for (const [key, value] of recallRows) {
            // Skip internal patterns keys if not searching for them
            const entryType = key.startsWith("patterns:") ? (key.split(":")[1] ?? "recall") : "recall";
            if (types && !types.includes(entryType)) continue;
            const s = score(query, key);
            if (s > 0) results.push({ type: entryType, key, value, score: s });
          }

          // Search pattern nodes by name
          const nodes = patterns.query({});
          for (const node of nodes as { id: string; type: string; name: string }[]) {
            if (types && !types.includes(node.type)) continue;
            const nameScore = score(query, node.name);
            const idScore = score(query, node.id);
            const s = Math.max(nameScore, idScore);
            if (s > 0) {
              const key = `patterns:node:${node.id}`;
              if (!results.some(r => r.key === key)) {
                results.push({ type: node.type, key, value: node, score: s });
              }
            }
          }

          // Search notes
          const noteRows = recall.query("patterns:note:%");
          for (const [key, notes] of noteRows) {
            const entity = key.replace("patterns:note:", "");
            for (const n of notes as { text: string; timestamp: number }[]) {
              if (n.text.toLowerCase().includes(q)) {
                results.push({ type: "note", key, value: { entity, ...n }, score: score(query, n.text) });
              }
            }
          }

          results.sort((a, b) => b.score - a.score);
          return results.slice(0, max);
        },
      };

      ctx.beacon = api;

      ctx.registerTool(
        "beacon_search",
        "Search across all context — recall data, graph nodes, and notes",
        {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string", minLength: 1, description: "Search query" },
            maxResults: { type: "integer", minimum: 1, maximum: 100, description: "Max results (default 20)" },
            types: { type: "array", items: { type: "string" }, description: "Filter by type" },
          },
        },
        async ({ query, maxResults, types }) => {
          const results = api.search(query as string, {
            maxResults: maxResults as number | undefined,
            types: types as string[] | undefined,
          });
          return { results, count: results.length };
        }
      );
    },
  } satisfies ModuleMetadata;
}
