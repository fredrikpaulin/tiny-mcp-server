import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { loadModules, closeModules, _reset } from "../src/mcp";
import type { ModuleContext, ModuleMetadata } from "../src/mcp";
import recall from "../src/modules/recall";
import patterns from "../src/modules/patterns";
import beacon from "../src/modules/beacon";
import type { RecallAPI } from "../src/modules/recall";
import type { PatternsAPI } from "../src/modules/patterns";
import type { BeaconAPI } from "../src/modules/beacon";

let ctx!: ModuleContext;
const probe: ModuleMetadata = { name: "probe", depends: ["recall", "patterns", "beacon"], init(c) { ctx = c; } };

const api = () => ({
  recall: ctx.recall as RecallAPI,
  patterns: ctx.patterns as PatternsAPI,
  beacon: ctx.beacon as BeaconAPI,
  db: (ctx.recall as RecallAPI).db(),
});

beforeEach(async () => { _reset(); await loadModules([recall(), patterns(), beacon(), probe]); });
afterEach(async () => { await closeModules(); _reset(); });

describe("beacon key to rowid mapping", () => {
  test("every indexed document has exactly one row in each index", () => {
    const { patterns: p, beacon: b, db } = api();
    b.reindex();

    p.addNode("utils/validate.ts:validate", "function", "validate");
    b.search("validate");

    const count = (t: string) => (db.prepare(`SELECT count(*) c FROM ${t} WHERE key = ?`).get("utils/validate.ts:validate") as { c: number }).c;
    expect(count("beacon_fts")).toBe(1);
    expect(count("beacon_tri")).toBe(1);
    expect((db.prepare(`SELECT count(*) c FROM beacon_docs`).get() as { c: number }).c).toBe(1);
  });

  test("re-indexing a document replaces it rather than duplicating it", () => {
    const { patterns: p, beacon: b, db } = api();
    b.reindex();

    p.addNode("a.ts:handler", "function", "handler");
    b.search("handler");
    const ridAfterFirst = (db.prepare(`SELECT rid FROM beacon_docs WHERE key = ?`).get("a.ts:handler") as { rid: number }).rid;

    // Same id, new name — an upsert, not an insert.
    p.addNode("a.ts:handler", "function", "handlerRenamed");
    b.search("handlerRenamed");

    const rows = db.prepare(`SELECT key, title FROM beacon_fts WHERE key = ?`).all("a.ts:handler") as { title: string }[];
    expect(rows.length).toBe(1);
    expect(rows[0]!.title).toBe("handlerRenamed");
    expect((db.prepare(`SELECT count(*) c FROM beacon_tri WHERE key = ?`).get("a.ts:handler") as { c: number }).c).toBe(1);
    // The rowid is reused, so the map does not grow on every update.
    expect((db.prepare(`SELECT rid FROM beacon_docs WHERE key = ?`).get("a.ts:handler") as { rid: number }).rid).toBe(ridAfterFirst);
  });

  test("a removed document leaves nothing behind in either index or the map", () => {
    const { patterns: p, beacon: b, db } = api();
    b.reindex();

    p.addNode("gone.ts:doomed", "function", "doomed");
    b.search("doomed");
    p.deleteNode("gone.ts:doomed");
    b.search("doomed");

    for (const t of ["beacon_fts", "beacon_tri", "beacon_docs"]) {
      expect((db.prepare(`SELECT count(*) c FROM ${t} WHERE key = ?`).get("gone.ts:doomed") as { c: number }).c).toBe(0);
    }
  });

  test("reindex clears the map and restarts rowid allocation", () => {
    const { patterns: p, beacon: b, db } = api();
    b.reindex();
    for (let i = 0; i < 5; i++) p.addNode(`m${i}.ts:f${i}`, "function", `f${i}`);
    b.search("f1");

    b.reindex();

    const rids = (db.prepare(`SELECT rid FROM beacon_docs ORDER BY rid`).all() as { rid: number }[]).map(r => r.rid);
    expect(rids.length).toBe(5);
    expect(rids[0]).toBe(1);
    expect(new Set(rids).size).toBe(5);
    // No orphaned index rows survive the rebuild.
    expect((db.prepare(`SELECT count(*) c FROM beacon_fts`).get() as { c: number }).c).toBe(5);
  });

  test("search still finds documents by title and returns them ranked", () => {
    const { patterns: p, beacon: b } = api();
    b.reindex();
    p.addNode("a.ts:parseModule", "function", "parseModule");
    p.addNode("b.ts:parseHeader", "function", "parseHeader");
    p.addNode("c.ts:unrelated", "function", "unrelated");

    const res = b.search("parseModule");
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.results[0]!.key).toBe("a.ts:parseModule");
    expect(res.results.map(r => r.key)).not.toContain("c.ts:unrelated");
  });

  test("boost still applies to scoring after the rowid change", () => {
    const { patterns: p, beacon: b } = api();
    b.reindex();
    p.addNode("a.ts:alphaOne", "function", "alphaOne");
    p.addNode("b.ts:alphaTwo", "function", "alphaTwo");
    b.search("alpha");            // flush both

    p.setBoost("b.ts:alphaTwo", 50);
    const res = b.search("alpha");
    expect(res.results[0]!.key).toBe("b.ts:alphaTwo");
  });

  test("index write cost does not grow with corpus size", () => {
    const { patterns: p, beacon: b } = api();
    b.reindex();

    // Upserting N documents costs O(N) with a rowid delete and O(N²) with a
    // key delete, because `key` is UNINDEXED and has no index to seek on.
    const perDoc = (n: number) => {
      for (let i = 0; i < n; i++) p.addNode(`f${i}.ts:fn${i}`, "function", `fn${i}`);
      b.search("fn0");                                   // first flush: inserts
      for (let i = 0; i < n; i++) p.addNode(`f${i}.ts:fn${i}`, "function", `fn${i}v2`);
      const t = performance.now();
      b.search("fn0");                                   // second flush: upserts
      return ((performance.now() - t) * 1000) / n;
    };

    const small = perDoc(500);
    b.reindex();
    const large = perDoc(4000);

    // Measured on the key-delete version: 223 us/doc at 500, 1465 at 4000.
    expect(large).toBeLessThan(small * 2);
  }, 30_000);
});

describe("beacon index statements", () => {
  test("no statement filters an FTS table on the UNINDEXED key column", async () => {
    const source = await Bun.file(new URL("../src/modules/beacon.ts", import.meta.url)).text();
    expect(source).not.toMatch(/DELETE FROM beacon_(fts|tri) WHERE key/);
    expect(source).toMatch(/DELETE FROM beacon_fts WHERE rowid = \?/);
    expect(source).toMatch(/DELETE FROM beacon_tri WHERE rowid = \?/);
  });
});
