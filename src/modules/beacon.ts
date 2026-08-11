/**
 * Beacon module — FTS5-powered context search for tiny-mcp-server.
 * Searches across Recall data, Patterns graph nodes, and notes.
 * Uses FTS5 with BM25 scoring and trigram fallback for substring matching.
 * Depends on Recall and Patterns.
 */
import type { ModuleMetadata, ModuleContext } from "../mcp";
import type { RecallAPI } from "./recall";
import type { PatternsAPI } from "./patterns";

export interface BeaconResult {
  type: string;
  key: string;
  value: unknown;
  score: number;
  matched_fields?: string[];
}

export interface BeaconSearchOpts {
  maxResults?: number;
  types?: string[];
}

export interface BeaconSearchResponse {
  results: BeaconResult[];
  count: number;
  timing: { query_ms: number; total_ms: number };
}

export interface BeaconAPI {
  search(query: string, opts?: BeaconSearchOpts): BeaconSearchResponse;
  reindex(): void;
}

const MIN_FTS_RESULTS = 5;

function sanitize(raw: string): string {
  const stripped = raw.slice(0, 255)
    .replace(/["""''*^{}():\\/]/g, "")
    .replace(/\b(AND|OR|NOT|NEAR)\b/gi, "");
  return stripped
    .split(/\s+/)
    .filter(t => t.length > 0)
    .map(t => `"${t}"`)
    .join(" ");
}

export default function beacon(config: { maxResults?: number } = {}) {
  const maxDefault = config.maxResults || 20;

  return {
    name: "beacon",
    depends: ["recall", "patterns"],

    init(ctx: ModuleContext) {
      const recall = ctx.recall as RecallAPI;
      const patterns = ctx.patterns as PatternsAPI;
      if (!recall || !patterns) throw new Error("Beacon requires Recall and Patterns modules");

      const db = recall.db();

      // FTS5 index — word-level tokenization with BM25
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS beacon_fts USING fts5(
          key UNINDEXED,
          type UNINDEXED,
          title,
          description,
          tokenize='unicode61 remove_diacritics 2'
        );
      `);

      // Trigram index — substring matching fallback
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS beacon_tri USING fts5(
          key UNINDEXED,
          type UNINDEXED,
          title,
          description,
          tokenize='trigram'
        );
      `);

      const stmts = {
        clearFts: db.prepare(`DELETE FROM beacon_fts`),
        clearTri: db.prepare(`DELETE FROM beacon_tri`),
        insertFts: db.prepare(`INSERT INTO beacon_fts (key, type, title, description) VALUES (?, ?, ?, ?)`),
        insertTri: db.prepare(`INSERT INTO beacon_tri (key, type, title, description) VALUES (?, ?, ?, ?)`),
        deleteFtsByKey: db.prepare(`DELETE FROM beacon_fts WHERE key = ?`),
        deleteTriByKey: db.prepare(`DELETE FROM beacon_tri WHERE key = ?`),
        searchFts: db.prepare(`
          SELECT key, type, (-rank) as fts_score,
            highlight(beacon_fts, 2, '<mark>', '</mark>') as title_hl,
            highlight(beacon_fts, 3, '<mark>', '</mark>') as desc_hl
          FROM beacon_fts
          WHERE beacon_fts MATCH ?
          ORDER BY rank
          LIMIT 100
        `),
        searchTri: db.prepare(`
          SELECT key, type, (-rank) as fts_score,
            highlight(beacon_tri, 2, '<mark>', '</mark>') as title_hl,
            highlight(beacon_tri, 3, '<mark>', '</mark>') as desc_hl
          FROM beacon_tri
          WHERE beacon_tri MATCH ?
          ORDER BY rank
          LIMIT 100
        `),
        getNodeBoost: db.prepare(`SELECT boost FROM patterns_nodes WHERE id = ?`),
      };

      function indexDoc(key: string, type: string, title: string, desc: string) {
        stmts.insertFts.run(key, type, title, desc);
        stmts.insertTri.run(key, type, title, desc);
      }

      function removeDoc(key: string) {
        stmts.deleteFtsByKey.run(key);
        stmts.deleteTriByKey.run(key);
      }

      function upsertDoc(key: string, type: string, title: string, desc: string) {
        removeDoc(key);
        indexDoc(key, type, title, desc);
      }

      function recallDesc(value: unknown): string {
        return typeof value === "string" ? value : (typeof value === "object" && value !== null ? JSON.stringify(value) : "");
      }

      // Full rebuild — used for the initial build (captures persisted data that
      // never fired an event) and for explicit repair via beacon_reindex.
      function reindex() {
        stmts.clearFts.run();
        stmts.clearTri.run();

        const nodes = patterns.query({}) as { id: string; type: string; name: string }[];
        for (const node of nodes) {
          const meta = patterns.getNode(node.id)?.metadata;
          indexDoc(node.id, node.type, node.name, meta?.description ? String(meta.description) : "");
        }

        const noteRows = db.prepare(`SELECT entity, text FROM patterns_notes`).all() as { entity: string; text: string }[];
        for (const n of noteRows) indexDoc(`note:${n.entity}`, "note", n.entity, n.text);

        for (const [key, value] of recall.query("%")) {
          if (key.startsWith("patterns:")) continue; // pattern nodes indexed above
          indexDoc(key, "recall", key, recallDesc(value));
        }

        indexed = true;
        pendingUpserts.clear();
        pendingDeletes.clear();
        pendingNotes.clear();
      }

      // Incremental indexing. Mutations accumulate as pending work and are
      // flushed (per-document upsert/delete) before the next search, so one
      // small write costs one small index update instead of a full rebuild.
      let indexed = false;
      const pendingUpserts = new Map<string, { type: string; title: string; desc: string }>();
      const pendingDeletes = new Set<string>();
      const pendingNotes = new Set<string>();

      function ensureIndexed() { if (!indexed) reindex(); }

      function flush() {
        if (!pendingDeletes.size && !pendingUpserts.size && !pendingNotes.size) return;
        for (const key of pendingDeletes) removeDoc(key);
        for (const [key, d] of pendingUpserts) upsertDoc(key, d.type, d.title, d.desc);
        for (const entity of pendingNotes) {
          removeDoc(`note:${entity}`);
          for (const n of patterns.getNotes(entity)) indexDoc(`note:${entity}`, "note", entity, n.text);
        }
        pendingDeletes.clear();
        pendingUpserts.clear();
        pendingNotes.clear();
      }

      // Build the index once modules are ready (captures data seeded during init)
      ctx.on("modules:ready", () => { ensureIndexed(); });

      // Edges are not indexed as searchable documents, so edge events are ignored.
      ctx.on("patterns:nodeAdded", (p: any) => {
        if (!indexed) return;
        pendingDeletes.delete(p.id);
        pendingUpserts.set(p.id, { type: p.type, title: p.name, desc: p.metadata?.description ? String(p.metadata.description) : "" });
      });
      ctx.on("patterns:nodeRemoved", (p: any) => {
        if (!indexed) return;
        pendingUpserts.delete(p.id);
        pendingDeletes.add(p.id);
      });
      ctx.on("patterns:noteAdded", (p: any) => {
        if (!indexed) return;
        pendingNotes.add(p.entity);
      });
      ctx.on("recall:set", (p: any) => {
        if (!indexed || typeof p.key !== "string" || p.key.startsWith("patterns:")) return;
        pendingDeletes.delete(p.key);
        pendingUpserts.set(p.key, { type: "recall", title: p.key, desc: recallDesc(p.value) });
      });
      ctx.on("recall:delete", (p: any) => {
        if (!indexed || typeof p.key !== "string") return;
        pendingUpserts.delete(p.key);
        pendingDeletes.add(p.key);
      });

      const api: BeaconAPI = {
        search(query, opts) {
          ensureIndexed();
          flush();
          const t0 = performance.now();
          const max = opts?.maxResults || maxDefault;
          const types = opts?.types;
          const sanitized = sanitize(query);

          if (!sanitized) return { results: [], count: 0, timing: { query_ms: 0, total_ms: 0 } };

          // Stage 1: FTS5 primary search
          const tq0 = performance.now();
          type FtsRow = { key: string; type: string; fts_score: number; title_hl: string; desc_hl: string };
          let candidates: FtsRow[] = [];
          try {
            candidates = stmts.searchFts.all(sanitized) as FtsRow[];
          } catch { /* FTS5 match can throw on unusual queries */ }

          // Stage 2: Trigram fallback if FTS5 returned few results
          const ftsKeys = new Set(candidates.map(c => c.key));
          if (candidates.length < MIN_FTS_RESULTS) {
            try {
              // Trigram needs quoted substring
              const triQuery = `"${query.slice(0, 255).replace(/"/g, "")}"`;
              const triResults = stmts.searchTri.all(triQuery) as FtsRow[];
              for (const row of triResults) {
                if (!ftsKeys.has(row.key)) {
                  // Slightly lower scores for trigram-only matches
                  candidates.push({ ...row, fts_score: row.fts_score * 0.7 });
                  ftsKeys.add(row.key);
                }
              }
            } catch { /* trigram match can also throw */ }
          }
          const tq1 = performance.now();

          // Stage 3: Filter and rank
          const results: BeaconResult[] = [];
          for (const row of candidates) {
            if (types && !types.includes(row.type)) continue;

            // Boost from patterns node if applicable
            const boostRow = stmts.getNodeBoost.get(row.key) as { boost: number } | null;
            const boost = boostRow?.boost || 0;
            const score = Math.max(0, Math.min(100, (row.fts_score + boost) * 10));

            // Detect matched fields from highlights
            const matched_fields: string[] = [];
            if (row.title_hl.includes("<mark>")) matched_fields.push("title");
            if (row.desc_hl.includes("<mark>")) matched_fields.push("description");

            // Fetch the actual value
            let value: unknown;
            if (row.type === "note") {
              const entity = row.key.replace("note:", "");
              const notes = patterns.getNotes(entity);
              value = { entity, notes };
            } else if (row.type === "recall") {
              value = recall.get(row.key);
            } else {
              value = patterns.getNode(row.key);
            }

            results.push({ type: row.type, key: row.key, value, score, matched_fields });
          }

          results.sort((a, b) => b.score - a.score);
          const sliced = results.slice(0, max);
          const t1 = performance.now();

          return {
            results: sliced,
            count: sliced.length,
            timing: { query_ms: Math.round((tq1 - tq0) * 100) / 100, total_ms: Math.round((t1 - t0) * 100) / 100 },
          };
        },

        reindex,
      };

      ctx.beacon = api;

      ctx.registerTool(
        "beacon_search",
        "Search across all context — recall data, graph nodes, and notes. Uses FTS5 full-text search with BM25 scoring and trigram fallback.",
        {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string", minLength: 1, description: "Search query" },
            maxResults: { type: "integer", minimum: 1, maximum: 100, description: "Max results (default 20)" },
            types: { type: "array", items: { type: "string" }, description: "Filter by result type" },
          },
        },
        async ({ query, maxResults, types }) => {
          const response = api.search(query as string, {
            maxResults: maxResults as number | undefined,
            types: types as string[] | undefined,
          });
          return response;
        }
      );

      ctx.registerTool(
        "beacon_reindex",
        "Rebuild the search index from current data. Call after bulk inserts into Patterns or Recall.",
        { type: "object", properties: {} },
        async () => {
          api.reindex();
          return { ok: true };
        }
      );
    },
  } satisfies ModuleMetadata;
}
