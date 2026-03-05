# Beacon Module

FTS5-powered context search for tiny-mcp-server. Searches across Recall data, Patterns graph nodes, and notes in a single query. Uses BM25 scoring with trigram fallback for substring matching.

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

Search across all context — recall data, graph nodes, and notes.

```json
{ "query": "serve", "maxResults": 10, "types": ["function"] }
```

Returns scored results with timing telemetry:

```json
{
  "results": [
    { "type": "function", "key": "srv", "value": {...}, "score": 85, "matched_fields": ["title"] },
    { "type": "recall", "key": "server-config", "value": {...}, "score": 42, "matched_fields": ["title", "description"] }
  ],
  "count": 2,
  "timing": { "query_ms": 0.12, "total_ms": 0.45 }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | `string` | yes | Search text (min 1 char) |
| `maxResults` | `integer` | no | Override default max (1–100) |
| `types` | `string[]` | no | Filter by result type |

### `beacon_reindex`

Manually rebuild the search index. Normally not needed — Beacon listens for data change events (`recall:set`, `recall:delete`, `patterns:nodeAdded`, etc.) and automatically marks the index as dirty. The index is rebuilt lazily before the next search.

Use `beacon_reindex` when you want to force an immediate rebuild, or if you've modified data outside the normal module APIs.

```json
{}
```

Returns `{ "ok": true }`.

## Search Pipeline

Beacon uses a multi-stage search pipeline:

**Stage 1 — FTS5 primary search.** Runs the sanitized query against `beacon_fts`, a full-text index using the `unicode61` tokenizer with diacritics removal. Results are ranked by BM25.

**Stage 2 — Trigram fallback.** If FTS5 returns fewer than 5 results, a second search runs against `beacon_tri`, a trigram-tokenized index that catches substring matches FTS5 misses. Trigram-only matches are scored at 70% of their raw score.

**Stage 3 — Filter and rank.** Candidates are filtered by `types` if specified, boosted by each node's `boost` value from the Patterns graph, and capped to a 0–100 score range. Results are sorted by score descending and sliced to `maxResults`.

## Query Sanitization

Queries are sanitized before hitting FTS5 to prevent syntax errors:

- Truncated to 255 characters
- FTS5 operators stripped (`AND`, `OR`, `NOT`, `NEAR`)
- Special characters removed (`"`, `*`, `^`, `{}`, `()`, `:`, `\`, `/`)
- Each remaining term is quote-wrapped for exact matching

## Indexing

The FTS index is built at module initialization and automatically stays fresh via event hooks. When data changes in Recall or Patterns, Beacon marks its index as dirty and rebuilds lazily before the next search. This means bulk inserts don't trigger repeated reindexing — only the next search pays the cost. Three data sources are indexed:

| Source | Type field | Key field | Title | Description |
|--------|-----------|-----------|-------|-------------|
| Pattern nodes | node type (e.g. `file`, `function`) | node ID | node name | metadata.description |
| Notes | `note` | `note:{entity}` | entity ID | note text |
| Recall entries | `recall` | recall key | recall key | JSON-stringified value |

Patterns internal keys (prefixed `patterns:`) are skipped since their data is already indexed via the nodes source.

## Boost

Nodes in the Patterns graph can have a `boost` value set via `patterns.setBoost(id, boost)`. During scoring, this boost is added to the raw FTS5/BM25 score before normalization, letting you promote important nodes in search results.

## Result Shape

Each result includes:

| Field | Type | Description |
|-------|------|-------------|
| `type` | `string` | Source type (`recall`, `note`, or node type) |
| `key` | `string` | Unique identifier |
| `value` | `unknown` | Full value from the source module |
| `score` | `number` | Normalized score (0–100) |
| `matched_fields` | `string[]` | Which indexed fields matched (`title`, `description`) |

## API for Other Modules

Beacon exposes `ctx.beacon`:

| Method | Signature | Description |
|--------|-----------|-------------|
| `search` | `(query, opts?) => BeaconSearchResponse` | Search with optional `{ maxResults, types }` |
| `reindex` | `() => void` | Rebuild FTS indexes from current data |
