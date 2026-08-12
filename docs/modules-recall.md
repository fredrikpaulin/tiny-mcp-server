# Recall Module

SQLite-based key-value persistence for tiny-mcp-server. Stores JSON values with pattern-based querying via SQL LIKE. Uses `bun:sqlite` with prepared statements, in WAL mode with `synchronous = NORMAL`.

## Setup

```ts
import { loadModules, serve } from "tiny-mcp-server";
import recall from "tiny-mcp-server/modules/recall";

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
| `internal` | `(prefix: string) => RecallAPI` | Create a namespaced view for a module's own bookkeeping |
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
const deep = ctx.recall.namespace("mymodule").namespace("session");
deep.set("last-run", { at: Date.now() });  // stored as "mymodule:session:last-run"
```

Note that Patterns does *not* store its graph through this API — it creates its own indexed `patterns_nodes`, `patterns_edges` and `patterns_notes` tables via `db()`. No key prefix is reserved or special-cased, so `patterns:anything` is an ordinary consumer key.

Query results from a namespaced API return keys with the prefix stripped, so downstream code doesn't need to know about the prefix.

## Module-internal state

`internal(prefix)` has the same shape as `namespace(prefix)`, but writes to a separate `recall_internal` table. Two things follow from that: the writes emit no `recall:set` or `recall:delete` events, and the keys never appear in `query()` on the public store — at any pattern, `%` included.

```ts
const cache = ctx.recall.internal("mymodule");
cache.set("hash:src/index.ts", "9f2c…");   // no event, not searchable
ctx.recall.query("%");                      // does not include it
```

Use it for a module's own bookkeeping — file hashes, cached graph slices, snapshots — and `namespace()` for anything the consumer would recognise as their own data. The distinction matters because Beacon indexes the public store as searchable content: Scanner's hash and slice cache used to land in the search index, where it accounted for 17% of indexed documents and every byte of indexed description text on a 300-file project.

Scanner, Prompt and Diff all use `internal()`. A database written before this existed keeps its bookkeeping in `recall_data`; those rows are moved into `recall_internal` the first time the owning module claims its prefix, so no migration step is needed.

`namespace()` on an internal store stays internal — there is no route back out to the public table.

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
);

-- Same shape, for module bookkeeping. Not searchable, emits no events.
CREATE TABLE recall_internal (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

The database runs in WAL mode, which leaves `-wal` and `-shm` files alongside the `.db` file. Copy all three, or checkpoint first — copying the `.db` on its own can lose committed writes.
