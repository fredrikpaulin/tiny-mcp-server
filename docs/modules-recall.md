# Recall Module

SQLite-based key-value persistence for tiny-mcp-server. Stores JSON values with pattern-based querying via SQL LIKE. Uses `bun:sqlite` with prepared statements for performance.

## Setup

```ts
import { loadModules, serve } from "tiny-mcp-server";
import recall from "tiny-mcp-server/src/modules/recall";

await loadModules([recall({ dbPath: "./data.db" })]);
serve();
```

### Config

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dbPath` | `string` | `":memory:"` | SQLite database path |

## Tools

### `recall_save`

Save a JSON value to a key. Overwrites if key exists.

```json
{ "key": "user:alice", "value": { "name": "Alice", "role": "admin" } }
```

### `recall_get`

Retrieve a value by key. Returns `{ value, found }`.

```json
{ "key": "user:alice" }
// → { "value": { "name": "Alice", "role": "admin" }, "found": true }
```

### `recall_query`

Find entries matching a SQL LIKE pattern. Use `%` as wildcard.

```json
{ "pattern": "user:%" }
// → { "results": { "user:alice": {...}, "user:bob": {...} }, "count": 2 }
```

### `recall_delete`

Remove an entry by key.

```json
{ "key": "user:alice" }
// → { "ok": true }
```

## API for Other Modules

Recall exposes `ctx.recall` with the following methods:

| Method | Signature | Description |
|--------|-----------|-------------|
| `set` | `(key: string, value: unknown) => void` | Upsert a value |
| `get` | `(key: string) => unknown \| null` | Get value or null |
| `query` | `(pattern: string) => [string, unknown][]` | LIKE query |
| `delete` | `(key: string) => void` | Remove entry |

Other modules (like Patterns and Beacon) use this API for their persistence.

## Database Schema

```sql
CREATE TABLE recall_data (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,      -- JSON-encoded
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)
```
