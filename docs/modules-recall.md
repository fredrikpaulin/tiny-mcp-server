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
| `namespace` | `(prefix: string) => RecallAPI` | Create a namespaced view |
| `db` | `() => Database` | Access the underlying SQLite database |

Other modules (like Patterns and Beacon) use this API for their persistence.

## Namespacing

`namespace(prefix)` returns a new `RecallAPI` where all keys are automatically prefixed. This prevents collisions between modules sharing the same database.

```ts
const ns = ctx.recall.namespace("mymodule");
ns.set("config", { debug: true });     // stored as "mymodule:config"
ns.get("config");                       // retrieves "mymodule:config"
ns.query("%");                          // matches "mymodule:*", returns stripped keys
ns.delete("config");                    // deletes "mymodule:config"
```

Namespaces can be nested:

```ts
const deep = ctx.recall.namespace("patterns").namespace("node");
deep.set("mcp.ts", { type: "file" });  // stored as "patterns:node:mcp.ts"
```

Query results from a namespaced API return keys with the prefix stripped, so downstream code doesn't need to know about the prefix.

## Direct Database Access

`db()` returns the underlying `bun:sqlite` `Database` handle. Modules that need custom tables with indexes (like Patterns) can create their own schema while sharing the same `.db` file:

```ts
const db = ctx.recall.db();
db.exec(`CREATE TABLE IF NOT EXISTS my_table (id TEXT PRIMARY KEY, data TEXT)`);
```

The Patterns module uses this to create indexed `patterns_nodes`, `patterns_edges`, and `patterns_notes` tables for fast graph queries.

## Database Schema

```sql
CREATE TABLE recall_data (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,      -- JSON-encoded
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)
```
