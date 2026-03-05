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
      db.exec(`
        CREATE TABLE IF NOT EXISTS recall_data (
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
          db: () => root.db(),
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
