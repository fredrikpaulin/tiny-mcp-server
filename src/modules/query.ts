/**
 * Query module — combines Patterns graph traversal with Beacon search
 * for predicate-based filtering over the context graph.
 * Depends on Patterns (required) and Beacon (optional, for text search).
 */
import type { ModuleMetadata, ModuleContext } from "../mcp";
import type { PatternsAPI, PatternsNode, Direction } from "./patterns";
import type { BeaconAPI } from "./beacon";

export interface QueryOptions {
  type?: string;
  where?: Record<string, unknown>;
  near?: { node: string; maxDepth?: number; direction?: Direction };
  relationship?: string;
  search?: string;
  limit?: number;
  sort?: string;
}

export interface QueryResultItem {
  id: string;
  type: string;
  name: string;
  metadata?: Record<string, unknown>;
  score?: number;
}

export interface QueryResult {
  results: QueryResultItem[];
  count: number;
  timing_ms: number;
}

export interface QueryAPI {
  find(opts: QueryOptions): QueryResult;
}

type Pred = { gt?: number; lt?: number; gte?: number; lte?: number; exists?: boolean; contains?: string; in?: unknown[] };

function matchPredicate(value: unknown, pred: Pred): boolean {
  if (pred.exists !== undefined) return pred.exists ? value != null : value == null;
  if (pred.gt !== undefined && !(typeof value === "number" && value > pred.gt)) return false;
  if (pred.lt !== undefined && !(typeof value === "number" && value < pred.lt)) return false;
  if (pred.gte !== undefined && !(typeof value === "number" && value >= pred.gte)) return false;
  if (pred.lte !== undefined && !(typeof value === "number" && value <= pred.lte)) return false;
  if (pred.contains !== undefined && !(typeof value === "string" && value.includes(pred.contains))) return false;
  if (pred.in !== undefined && !pred.in.includes(value)) return false;
  return true;
}

function matchWhere(metadata: Record<string, unknown> | undefined, where: Record<string, unknown>): boolean {
  for (const [key, constraint] of Object.entries(where)) {
    const value = metadata?.[key];
    if (constraint !== null && typeof constraint === "object" && !Array.isArray(constraint)) {
      if (!matchPredicate(value, constraint as Pred)) return false;
    } else {
      if (value !== constraint) return false;
    }
  }
  return true;
}

export default function query() {
  return {
    name: "query",
    depends: ["patterns"],

    init(ctx: ModuleContext) {
      const patterns = ctx.patterns as PatternsAPI;
      if (!patterns) throw new Error("Query requires Patterns module");
      const beacon = ctx.beacon as BeaconAPI | undefined;

      function find(opts: QueryOptions): QueryResult {
        const t0 = performance.now();
        const limit = opts.limit ?? 20;
        let candidates: Map<string, QueryResultItem> | null = null;

        // Stage 1a: Text search via Beacon
        if (opts.search && beacon) {
          const res = beacon.search(opts.search, {
            maxResults: limit * 5, // over-fetch for filtering
            types: opts.type ? [opts.type] : undefined,
          });
          candidates = new Map();
          for (const r of res.results) {
            candidates.set(r.key, {
              id: r.key,
              type: r.type,
              name: r.key,
              metadata: typeof r.value === "object" && r.value !== null ? (r.value as Record<string, unknown>) : undefined,
              score: r.score,
            });
          }
        }

        // Stage 1b: Proximity via traverse
        if (opts.near) {
          const { node, maxDepth = 3, direction = "both" } = opts.near;
          const traversal = patterns.traverse(node, { direction, maxDepth });
          const nearSet = new Map<string, PatternsNode>();
          for (const n of traversal.nodes) nearSet.set(n.id, n);

          if (candidates) {
            // Intersect with search results
            for (const [id] of candidates) {
              if (!nearSet.has(id)) candidates.delete(id);
            }
          } else {
            candidates = new Map();
            for (const n of traversal.nodes) {
              candidates.set(n.id, {
                id: n.id, type: n.type, name: n.name,
                metadata: n.metadata as Record<string, unknown> | undefined,
              });
            }
          }
        }

        // Stage 1c: Type filter via Patterns query
        if (opts.type && !candidates) {
          const nodes = patterns.query({ type: opts.type }) as PatternsNode[];
          candidates = new Map();
          for (const n of nodes) {
            candidates.set(n.id, {
              id: n.id, type: n.type, name: n.name,
              metadata: n.metadata as Record<string, unknown> | undefined,
            });
          }
        }

        // Stage 1d: All nodes if no filters given yet
        if (!candidates) {
          const nodes = patterns.query({}) as PatternsNode[];
          candidates = new Map();
          for (const n of nodes) {
            candidates.set(n.id, {
              id: n.id, type: n.type, name: n.name,
              metadata: n.metadata as Record<string, unknown> | undefined,
            });
          }
        }

        // Stage 2: Type filter (if we got candidates from near/search but still need type filter)
        if (opts.type && (opts.near || opts.search)) {
          for (const [id, item] of candidates) {
            if (item.type !== opts.type) candidates.delete(id);
          }
        }

        // Stage 3: Metadata predicates
        if (opts.where) {
          for (const [id, item] of candidates) {
            if (!matchWhere(item.metadata, opts.where)) candidates.delete(id);
          }
        }

        // Stage 4: Relationship filter
        if (opts.relationship) {
          const edges = patterns.query({ relationship: opts.relationship }) as { from: string; to: string }[];
          const connected = new Set<string>();
          for (const e of edges) { connected.add(e.from); connected.add(e.to); }
          for (const [id] of candidates) {
            if (!connected.has(id)) candidates.delete(id);
          }
        }

        // Stage 5: Sort
        let results = [...candidates.values()];
        if (opts.sort) {
          const field = opts.sort;
          if (field === "score") {
            results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
          } else {
            results.sort((a, b) => {
              const av = a.metadata?.[field];
              const bv = b.metadata?.[field];
              if (typeof av === "number" && typeof bv === "number") return bv - av;
              return 0;
            });
          }
        } else if (opts.search) {
          results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        }

        // Stage 6: Limit
        if (results.length > limit) results = results.slice(0, limit);

        const timing_ms = Math.round((performance.now() - t0) * 100) / 100;
        return { results, count: results.length, timing_ms };
      }

      const api: QueryAPI = { find };
      ctx.query = api;

      ctx.registerTool(
        "query_find",
        "Find nodes in the context graph using combined structural, metadata, and text search filters.",
        {
          type: "object",
          properties: {
            type: { type: "string", description: "Filter by node type (function, class, file, interface, type, variable)" },
            where: {
              type: "object",
              description: "Metadata predicates. Exact match: {\"exported\": true}. Operators: {\"complexity\": {\"gt\": 5}}, {\"returnType\": {\"contains\": \"Promise\"}}. Supported: gt, lt, gte, lte, exists, contains, in.",
            },
            near: {
              type: "object",
              description: "Proximity constraint: {\"node\": \"server.ts\", \"maxDepth\": 2, \"direction\": \"outgoing\"}",
              properties: {
                node: { type: "string", description: "Center node ID" },
                maxDepth: { type: "number", description: "Max graph distance (default 3)" },
                direction: { type: "string", enum: ["outgoing", "incoming", "both"], description: "Traversal direction (default both)" },
              },
              required: ["node"],
            },
            relationship: { type: "string", description: "Only include nodes connected via this relationship type" },
            search: { type: "string", description: "Text search query (uses Beacon full-text search)" },
            limit: { type: "number", description: "Max results (default 20)" },
            sort: { type: "string", description: "Sort by metadata field name or 'score' for search ranking" },
          },
        },
        async (args) => {
          return find({
            type: args.type as string | undefined,
            where: args.where as Record<string, unknown> | undefined,
            near: args.near as QueryOptions["near"],
            relationship: args.relationship as string | undefined,
            search: args.search as string | undefined,
            limit: args.limit as number | undefined,
            sort: args.sort as string | undefined,
          });
        }
      );
    },
  } satisfies ModuleMetadata;
}
