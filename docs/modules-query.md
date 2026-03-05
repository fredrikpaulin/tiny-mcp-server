# Query Module

Combines Patterns graph traversal with Beacon full-text search for predicate-based filtering over the context graph. Find nodes by type, metadata constraints, proximity to other nodes, relationship participation, and text search — all in a single call.

## Setup

```ts
import { loadModules, serve } from "tiny-mcp-server";
import recall from "tiny-mcp-server/src/modules/recall";
import patterns from "tiny-mcp-server/src/modules/patterns";
import beacon from "tiny-mcp-server/src/modules/beacon";
import query from "tiny-mcp-server/src/modules/query";

await loadModules([
  recall({ dbPath: "./context.db" }),
  patterns(),
  beacon(),  // optional — enables text search
  query(),
]);
serve();
```

**Depends on:** `patterns` (required), `beacon` (optional, for `search` parameter)

## Tools

### `query_find`

Find nodes using combined filters.

```json
{
  "type": "function",
  "where": { "complexity": { "gt": 5 }, "exported": true },
  "near": { "node": "server.ts", "maxDepth": 2, "direction": "outgoing" },
  "sort": "complexity",
  "limit": 10
}
```

Returns:
```json
{
  "results": [
    {
      "id": "server.ts:complexHandler",
      "type": "function",
      "name": "complexHandler",
      "metadata": { "complexity": 7, "exported": false, "loopCount": 2 }
    }
  ],
  "count": 1,
  "timing_ms": 1.23
}
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `type` | `string` | Filter by node type: function, class, file, interface, type, variable |
| `where` | `object` | Metadata predicates (see below) |
| `near` | `object` | Proximity: `{ node, maxDepth?, direction? }` |
| `relationship` | `string` | Only nodes connected via this edge type |
| `search` | `string` | Beacon full-text search query (adds score-based ranking) |
| `limit` | `number` | Max results (default 20) |
| `sort` | `string` | Sort by metadata field or `"score"` for search ranking |

### Where Predicates

Exact match: `{ "exported": true }`

Operators use nested objects:

| Operator | Example | Description |
|----------|---------|-------------|
| `gt` | `{ "complexity": { "gt": 5 } }` | Greater than |
| `lt` | `{ "lineCount": { "lt": 100 } }` | Less than |
| `gte` | `{ "loopCount": { "gte": 1 } }` | Greater than or equal |
| `lte` | `{ "maxNesting": { "lte": 3 } }` | Less than or equal |
| `exists` | `{ "returnType": { "exists": true } }` | Field exists / not null |
| `contains` | `{ "returnType": { "contains": "Promise" } }` | String contains substring |
| `in` | `{ "name": { "in": ["foo", "bar"] } }` | Value in set |

## Execution Pipeline

1. **Gather candidates** — broadest filter first:
   - `search` → Beacon results with scores
   - `near` → Patterns traverse from center node
   - `type` → Patterns query by type
   - None → all nodes
2. **Intersect** — if multiple sources, keep only shared nodes
3. **Filter by `where`** — apply metadata predicates
4. **Filter by `relationship`** — only keep nodes with matching edges
5. **Sort** — by metadata field or score (descending)
6. **Limit** — cap at max results

## API for Other Modules

Query exposes `ctx.query`:

| Method | Signature | Description |
|--------|-----------|-------------|
| `find` | `(opts: QueryOptions) => QueryResult` | Execute a combined query |

## Example Queries

Find the most complex functions:
```json
{ "type": "function", "sort": "complexity", "limit": 5 }
```

Find exported async functions:
```json
{ "type": "function", "where": { "exported": true, "async": true } }
```

Find functions with side effects near a file:
```json
{
  "type": "function",
  "relationship": "has_effect",
  "near": { "node": "server.ts", "maxDepth": 2 }
}
```

Search for "validate" in functions:
```json
{ "search": "validate", "type": "function" }
```

Find interfaces that extend something:
```json
{ "type": "interface", "where": { "extends": { "exists": true } } }
```
