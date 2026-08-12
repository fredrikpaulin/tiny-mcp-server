/**
 * Recall module — SQLite persistence for tiny-mcp-server.
 * Provides key-value storage with pattern-based querying.
 */
import { Database } from "bun:sqlite";
import type { ModuleMetadata, ModuleContext } from "../mcp";

export interface RecallAPI {
  set(key: string, value: unknown): void;
  get(key: string): unknown | null;
  query(pattern: string): [string, unknown][];
  delete(key: string): void;
  namespace(prefix: string): RecallAPI;
  /**
   * A store for a module's own bookkeeping — scan hashes, graph slices, cached
   * snapshots. Same shape as `namespace()`, but backed by a separate table:
   * writes emit no events and never appear in `query()`, so downstream modules
   * cannot mistake server internals for the consumer's data. Consumers building
   * a server have no reason to call this.
   */
  internal(prefix: string): RecallAPI;
  db(): import("bun:sqlite").Database;
}

export default function recall(config: { dbPath?: string } = {}) {
  let db: Database;

  return {
    name: "recall",
    schema: {
      type: "object",
      properties: {
        dbPath: { type: "string" },
      },
    },

    init(ctx: ModuleContext) {
      db = new Database(config.dbPath || ":memory:");

      // bun:sqlite applies no PRAGMAs, so a file-backed database opens on
      // journal_mode=delete and synchronous=FULL. WAL roughly doubles read
      // throughput; NORMAL is the single largest lever for unbatched writes.
      // Both are no-ops for :memory:, which has no journal to switch.
      db.exec("PRAGMA journal_mode = WAL");
      db.exec("PRAGMA synchronous = NORMAL");

      db.exec(`
        CREATE TABLE IF NOT EXISTS recall_data (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);

      // Module bookkeeping lives in its own table. Keeping it in recall_data made
      // it indistinguishable from the consumer's data: it surfaced in query("%")
      // and, via recall:set, in Beacon's search index.
      db.exec(`
        CREATE TABLE IF NOT EXISTS recall_internal (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);

      const stmts = {
        upsert: db.prepare(`INSERT INTO recall_data (key, value, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`),
        get: db.prepare(`SELECT value FROM recall_data WHERE key = ?`),
        query: db.prepare(`SELECT key, value FROM recall_data WHERE key LIKE ? ORDER BY updated_at DESC`),
        del: db.prepare(`DELETE FROM recall_data WHERE key = ?`),
      };

      const internalStmts = {
        upsert: db.prepare(`INSERT INTO recall_internal (key, value, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`),
        get: db.prepare(`SELECT value FROM recall_internal WHERE key = ?`),
        query: db.prepare(`SELECT key, value FROM recall_internal WHERE key LIKE ? ORDER BY updated_at DESC`),
        del: db.prepare(`DELETE FROM recall_internal WHERE key = ?`),
        // Match on an exact prefix rather than LIKE, so a prefix containing % or _
        // cannot widen the migration into the consumer's own keys.
        adopt: db.prepare(`INSERT INTO recall_internal (key, value, created_at, updated_at)
          SELECT key, value, created_at, updated_at FROM recall_data WHERE substr(key, 1, ?) = ?
          ON CONFLICT(key) DO NOTHING`),
        release: db.prepare(`DELETE FROM recall_data WHERE substr(key, 1, ?) = ?`),
      };

      // Databases written before recall_internal existed hold this module's keys
      // in recall_data. Move them the first time the owning module claims the
      // prefix, so nothing has to keep a list of which prefixes are internal.
      // The sweep scans recall_data, so each prefix is claimed once per process.
      const adopted = new Set<string>();
      const adopt = db.transaction((marker: string) => {
        internalStmts.adopt.run(marker.length, marker);
        internalStmts.release.run(marker.length, marker);
      });

      function adoptPrefix(prefix: string) {
        if (adopted.has(prefix)) return;
        adopted.add(prefix);
        adopt(`${prefix}:`);
      }

      function makeNamespaced(root: RecallAPI, prefix: string): RecallAPI {
        return {
          set: (key, value) => root.set(`${prefix}:${key}`, value),
          get: (key) => root.get(`${prefix}:${key}`),
          query: (pattern) => {
            const rows = root.query(`${prefix}:${pattern}`);
            return rows.map(([k, v]) => [k.slice(prefix.length + 1), v]);
          },
          delete: (key) => root.delete(`${prefix}:${key}`),
          namespace: (sub) => makeNamespaced(root, `${prefix}:${sub}`),
          internal: (sub) => makeInternal(`${prefix}:${sub}`),
          db: () => root.db(),
        };
      }

      // Same shape as a namespace, backed by recall_internal. No events, and
      // invisible to query() on the public store. namespace() on an internal
      // store stays internal — there is no route back out to recall_data.
      function makeInternal(prefix: string): RecallAPI {
        adoptPrefix(prefix);
        const full = (key: string) => `${prefix}:${key}`;
        return {
          set(key, value) {
            const now = Date.now();
            internalStmts.upsert.run(full(key), JSON.stringify(value), now, now);
          },
          get(key) {
            const row = internalStmts.get.get(full(key)) as { value: string } | null;
            return row ? JSON.parse(row.value) : null;
          },
          query(pattern) {
            const rows = internalStmts.query.all(full(pattern)) as { key: string; value: string }[];
            return rows.map(r => [r.key.slice(prefix.length + 1), JSON.parse(r.value)]);
          },
          delete(key) { internalStmts.del.run(full(key)); },
          namespace: (sub) => makeInternal(`${prefix}:${sub}`),
          internal: (sub) => makeInternal(`${prefix}:${sub}`),
          db: () => db,
        };
      }

      const api: RecallAPI = {
        set(key, value) {
          const now = Date.now();
          stmts.upsert.run(key, JSON.stringify(value), now, now);
          ctx.emit?.("recall:set", { key, value });
        },
        get(key) {
          const row = stmts.get.get(key) as { value: string } | null;
          return row ? JSON.parse(row.value) : null;
        },
        query(pattern) {
          const rows = stmts.query.all(pattern) as { key: string; value: string }[];
          return rows.map(r => [r.key, JSON.parse(r.value)]);
        },
        delete(key) {
          stmts.del.run(key);
          ctx.emit?.("recall:delete", { key });
        },
        namespace: (prefix) => makeNamespaced(api, prefix),
        internal: (prefix) => makeInternal(prefix),
        db: () => db,
      };

      ctx.recall = api;

      ctx.registerTool(
        "recall_save",
        "Save data to persistent recall store",
        {
          type: "object",
          required: ["key", "value"],
          properties: {
            key: { type: "string", description: "Storage key" },
            value: { description: "JSON value to store" },
          },
        },
        async ({ key, value }) => {
          api.set(key as string, value);
          return { ok: true };
        }
      );

      ctx.registerTool(
        "recall_get",
        "Retrieve data from recall store by key",
        {
          type: "object",
          required: ["key"],
          properties: {
            key: { type: "string", description: "Storage key to retrieve" },
          },
        },
        async ({ key }) => {
          const val = api.get(key as string);
          return { value: val, found: val !== null };
        }
      );

      ctx.registerTool(
        "recall_query",
        "Query recall store with SQL LIKE pattern (use % as wildcard)",
        {
          type: "object",
          required: ["pattern"],
          properties: {
            pattern: { type: "string", description: "SQL LIKE pattern, e.g. 'user:%'" },
          },
        },
        async ({ pattern }) => {
          const results = api.query(pattern as string);
          return { results: Object.fromEntries(results), count: results.length };
        }
      );

      ctx.registerTool(
        "recall_delete",
        "Delete entry from recall store",
        {
          type: "object",
          required: ["key"],
          properties: {
            key: { type: "string", description: "Storage key to delete" },
          },
        },
        async ({ key }) => {
          api.delete(key as string);
          return { ok: true };
        }
      );
    },

    close() {
      if (db) db.close();
    },
  } satisfies ModuleMetadata;
}
