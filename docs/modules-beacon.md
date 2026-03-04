# Beacon Module

Fast context search for tiny-mcp-server. Searches across Recall data, Patterns graph nodes, and notes in a single query. Returns scored and sorted results.

## Setup

```ts
import { loadModules, serve } from "tiny-mcp-server";
import recall from "tiny-mcp-server/src/modules/recall";
import patterns from "tiny-mcp-server/src/modules/patterns";
import beacon from "tiny-mcp-server/src/modules/beacon";

await loadModules([
  recall({ dbPath: "./context.db" }),
  patterns(),
  beacon({ maxResults: 20 }),
]);
serve();
```

**Depends on:** `recall`, `patterns`

### Config

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxResults` | `number` | `20` | Default max results per search |

## Tools

### `beacon_search`

Search across all context.

```json
{ "query": "serve", "maxResults": 10, "types": ["function"] }
```

Returns scored results:

```json
{
  "results": [
    { "type": "function", "key": "patterns:node:srv", "value": {...}, "score": 0.8 },
    { "type": "recall", "key": "server-config", "value": {...}, "score": 0.5 }
  ],
  "count": 2
}
```

### Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | `string` | yes | Search text (min 1 char) |
| `maxResults` | `integer` | no | Override default max results |
| `types` | `string[]` | no | Filter by result type |

## Search Strategy

Beacon searches three sources and merges results:

1. **Recall keys** — matches keys containing the query via SQL LIKE
2. **Pattern nodes** — matches node names and IDs
3. **Notes** — matches note text content

## Scoring

| Match | Score |
|-------|-------|
| Exact match | 1.0 |
| Starts with query | 0.8 |
| Contains query | 0.5–0.8 (proportional to length ratio) |
| No match | 0 (excluded) |

Results are sorted by score descending.

## API for Other Modules

Beacon exposes `ctx.beacon`:

| Method | Description |
|--------|-------------|
| `search(query, opts?)` | Search with optional `{ maxResults, types }` |
