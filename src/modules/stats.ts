/**
 * Stats module — aggregate metrics from the Patterns graph.
 * Provides complexity totals, most-connected nodes, dependency depth,
 * and hotspot detection. Depends on Patterns.
 */
import type { ModuleMetadata, ModuleContext } from "../mcp";
import type { PatternsAPI, PatternsNode, PatternsEdge } from "./patterns";

export interface StatsResult {
  nodesByType: Record<string, number>;
  edgesByRelationship: Record<string, number>;
  totalNodes: number;
  totalEdges: number;
  avgComplexity: number;
  maxComplexity: { id: string; value: number } | null;
  mostConnected: { id: string; degree: number }[];
  hotspots: { id: string; score: number }[];
  maxDepth: number;
}

export interface StatsAPI {
  compute(): StatsResult;
}

export default function stats() {
  return {
    name: "stats",
    depends: ["patterns"],

    init(ctx: ModuleContext) {
      const patterns = ctx.patterns as PatternsAPI;
      if (!patterns) throw new Error("Stats requires Patterns module");

      function compute(): StatsResult {
        const nodes = patterns.query({}) as PatternsNode[];
        const edges = patterns.allEdges();

        // Counts by type
        const nodesByType: Record<string, number> = {};
        for (const n of nodes) nodesByType[n.type] = (nodesByType[n.type] || 0) + 1;

        const edgesByRelationship: Record<string, number> = {};
        for (const e of edges) edgesByRelationship[e.relationship] = (edgesByRelationship[e.relationship] || 0) + 1;

        // Complexity stats (from function node metadata)
        let totalComplexity = 0;
        let complexityCount = 0;
        let maxComplexity: { id: string; value: number } | null = null;

        for (const n of nodes) {
          const c = (n.metadata as any)?.complexity;
          if (typeof c === "number") {
            totalComplexity += c;
            complexityCount++;
            if (!maxComplexity || c > maxComplexity.value) {
              maxComplexity = { id: n.id, value: c };
            }
          }
        }

        // Degree (in + out) for each node
        const degree = new Map<string, number>();
        for (const e of edges) {
          degree.set(e.from, (degree.get(e.from) || 0) + 1);
          degree.set(e.to, (degree.get(e.to) || 0) + 1);
        }

        const sorted = [...degree.entries()].sort((a, b) => b[1] - a[1]);
        const mostConnected = sorted.slice(0, 10).map(([id, deg]) => ({ id, degree: deg }));

        // Hotspot scoring: complexity * degree (high complexity + many connections = hotspot)
        const hotspots: { id: string; score: number }[] = [];
        for (const n of nodes) {
          const c = (n.metadata as any)?.complexity;
          if (typeof c !== "number") continue;
          const deg = degree.get(n.id) || 0;
          const score = c * (1 + deg);
          if (score > 0) hotspots.push({ id: n.id, score });
        }
        hotspots.sort((a, b) => b.score - a.score);

        // Max dependency depth via BFS from root file nodes
        const fileNodes = nodes.filter(n => n.type === "file");
        const outgoing = new Map<string, string[]>();
        for (const e of edges) {
          if (e.relationship === "imports") {
            let arr = outgoing.get(e.from);
            if (!arr) { arr = []; outgoing.set(e.from, arr); }
            arr.push(e.to);
          }
        }

        let maxDepth = 0;
        for (const root of fileNodes) {
          const visited = new Set<string>();
          const queue: { id: string; depth: number }[] = [{ id: root.id, depth: 0 }];
          while (queue.length) {
            const { id, depth } = queue.shift()!;
            if (visited.has(id)) continue;
            visited.add(id);
            if (depth > maxDepth) maxDepth = depth;
            for (const next of outgoing.get(id) || []) {
              if (!visited.has(next)) queue.push({ id: next, depth: depth + 1 });
            }
          }
        }

        return {
          nodesByType,
          edgesByRelationship,
          totalNodes: nodes.length,
          totalEdges: edges.length,
          avgComplexity: complexityCount ? totalComplexity / complexityCount : 0,
          maxComplexity,
          mostConnected,
          hotspots: hotspots.slice(0, 10),
          maxDepth,
        };
      }

      const api: StatsAPI = { compute };
      ctx.stats = api;

      ctx.registerTool(
        "graph_stats",
        "Compute aggregate metrics from the context graph: node/edge counts, complexity stats, most-connected nodes, hotspots, and dependency depth.",
        { type: "object", properties: {} },
        async () => compute()
      );
    },
  } satisfies ModuleMetadata;
}
