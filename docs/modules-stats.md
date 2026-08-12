# Stats Module

Aggregate metrics over the Patterns graph — node and edge counts by kind, complexity totals, the most-connected nodes, hotspots, and maximum dependency depth. One call, no arguments.

Useful for orienting in a codebase you don't know, and for spotting the files that will hurt to change.

## Setup

```ts
import { loadModules, serve } from "tiny-mcp-server";
import recall from "tiny-mcp-server/modules/recall";
import patterns from "tiny-mcp-server/modules/patterns";
import stats from "tiny-mcp-server/modules/stats";

await loadModules([
  recall({ dbPath: "./context.db" }),
  patterns(),
  stats(),
]);
serve();
```

**Depends on:** `patterns`

Populate the graph first, usually with [Scanner](modules-scanner.md). Against an empty graph the counts are `{}`, the lists are `[]`, `maxComplexity` is `null`, and the numeric totals are zero.

## Tools

### `graph_stats`

Takes no arguments.

```json
{}
```

Returns:
```json
{
  "nodesByType": { "file": 301, "function": 1498, "class": 301, "interface": 301, "type": 301, "variable": 301 },
  "edgesByRelationship": { "defines": 2107, "imports": 892, "calls": 1503, "exports": 1192 },
  "totalNodes": 3003,
  "totalEdges": 5694,
  "avgComplexity": 3.8,
  "maxComplexity": { "id": "server.ts:handleRequest", "value": 24 },
  "mostConnected": [
    { "id": "utils/types.ts", "degree": 84 },
    { "id": "server.ts", "degree": 61 }
  ],
  "hotspots": [
    { "id": "server.ts:handleRequest", "score": 312 }
  ],
  "maxDepth": 7
}
```

## What the numbers mean

| Field | Definition |
|-------|-----------|
| `nodesByType` | Count of nodes per `type` — `file`, `function`, `class`, `interface`, `type`, `variable` |
| `edgesByRelationship` | Count of edges per relationship |
| `avgComplexity` | Mean `metadata.complexity` across nodes that have one. Nodes without it are excluded from the mean, not counted as zero. |
| `maxComplexity` | The single highest-complexity node, or `null` if nothing carries the metric |
| `mostConnected` | Top 10 by degree, where degree is in-edges plus out-edges |
| `hotspots` | Top 10 by `complexity × (1 + degree)` |
| `maxDepth` | Largest number of `imports` hops from a file node to anything reachable from it, measured along shortest paths |

`hotspots` only includes nodes scoring above zero, so a node with `complexity: 0` never appears. `mostConnected` is built from the degree map, so a node with no edges at all is absent — both lists can be shorter than 10.

**Hotspots** are the interesting one. Complexity alone finds hard functions; degree alone finds popular ones. The product finds code that is both hard to understand and widely depended on — which is where a change is most likely to go wrong. The `1 +` means an unconnected but complex function still scores, rather than multiplying out to zero.

**`maxDepth`** counts `imports` edges only, running a BFS from every `file` node and keeping the largest depth reached.

Read it as a distance, not as a longest chain. BFS fixes each file at the depth it is *first* discovered, so where a file is reachable both directly and via a longer route, only the shorter distance counts. Given `a → b`, `a → c`, `c → b`, `b → d`, the longest chain is `a → c → b → d` (three hops) but the reported depth is 2, because `b` was already fixed at depth 1 by the direct edge. A cycle cannot inflate the figure for the same reason.

## API for Other Modules

Stats exposes `ctx.stats`:

| Method | Signature | Description |
|--------|-----------|-------------|
| `compute` | `() => StatsResult` | Compute all metrics |

```ts
const s = ctx.stats.compute();
const worst = s.hotspots[0];
if (worst && worst.score > 200) {
  ctx.patterns.addNote(worst.id, "Flagged by stats: high complexity and heavily depended on.");
}
```

## Cost

Counts, complexity and degree are one pass each over nodes and edges. The depth pass is not linear: it runs one BFS per `file` node, so it costs roughly files × files-reachable-from-each — near-linear on a flat import graph, closer to quadratic on a deep one. Measured on a synthetic chain of imports: 200 files 8.5 ms, 400 files 29.5 ms, 800 files 94.5 ms, so roughly 3.2× per doubling.

On the 3,000-node, 5,700-edge graph used for the audit benchmarks it takes about 90 ms end to end. Nothing is cached — each call recomputes from the current graph, which is what you want after a scan and wasteful in a loop.
