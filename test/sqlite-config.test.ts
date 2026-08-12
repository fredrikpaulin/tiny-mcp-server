import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { loadModules, closeModules, _reset } from "../src/mcp";
import type { ModuleContext, ModuleMetadata } from "../src/mcp";
import recall from "../src/modules/recall";
import patterns from "../src/modules/patterns";
import beacon from "../src/modules/beacon";
import type { RecallAPI } from "../src/modules/recall";
import type { PatternsAPI } from "../src/modules/patterns";
import { unlinkSync } from "node:fs";

// Grabs the shared context so a test can reach the module APIs directly.
function probe(onInit: (ctx: ModuleContext) => void): ModuleMetadata {
  return { name: "probe", depends: ["recall", "patterns", "beacon"], init: onInit };
}

const DB = "/tmp/tiny-mcp-sqlite-config.db";
function removeDb() {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(DB + suffix); } catch { /* not there */ }
  }
}

beforeEach(() => { _reset(); removeDb(); });
afterEach(async () => { await closeModules(); _reset(); removeDb(); });

describe("recall database configuration", () => {
  test("a file-backed database runs in WAL with synchronous=NORMAL", async () => {
    let ctx!: ModuleContext;
    await loadModules([recall({ dbPath: DB }), patterns(), beacon(), probe(c => { ctx = c; })]);

    const db = (ctx.recall as RecallAPI).db();
    expect((db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toBe("wal");
    expect((db.prepare("PRAGMA synchronous").get() as { synchronous: number }).synchronous).toBe(1);
  });

  test("an in-memory database loads without throwing", async () => {
    let ctx!: ModuleContext;
    await loadModules([recall(), patterns(), beacon(), probe(c => { ctx = c; })]);

    const db = (ctx.recall as RecallAPI).db();
    // :memory: has no rollback journal to switch, so it reports its own mode.
    expect((db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toBe("memory");
    (ctx.recall as RecallAPI).set("k", { ok: true });
    expect((ctx.recall as RecallAPI).get("k")).toEqual({ ok: true });
  });
});

describe("beacon index writes are batched", () => {
  test("reindex runs inside a transaction", async () => {
    let ctx!: ModuleContext;
    await loadModules([recall(), patterns(), beacon(), probe(c => { ctx = c; })]);

    const recallApi = ctx.recall as RecallAPI;
    const db = recallApi.db();

    // beacon holds the recall API object, so wrapping a method observes the
    // transaction state at the moment beacon calls it during a rebuild.
    const seen: boolean[] = [];
    const original = recallApi.query.bind(recallApi);
    recallApi.query = (pattern: string) => { seen.push(db.inTransaction); return original(pattern); };

    (ctx.beacon as { reindex(): void }).reindex();

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(Boolean)).toBe(true);
    expect(db.inTransaction).toBe(false);
  });

  test("flushing queued index work runs inside a transaction", async () => {
    let ctx!: ModuleContext;
    await loadModules([recall(), patterns(), beacon(), probe(c => { ctx = c; })]);

    const patternsApi = ctx.patterns as PatternsAPI;
    const db = (ctx.recall as RecallAPI).db();
    const beaconApi = ctx.beacon as { search(q: string): unknown; reindex(): void };

    beaconApi.reindex();                       // mark the index built
    patternsApi.addNode("a", "function", "alpha");
    patternsApi.addNote("a", "a note about alpha");

    const seen: boolean[] = [];
    const original = patternsApi.getNotes.bind(patternsApi);
    patternsApi.getNotes = (entity: string) => { seen.push(db.inTransaction); return original(entity); };

    // A query that matches nothing still flushes the queue first, but hydrates no
    // results — so every getNotes call observed here comes from the flush.
    beaconApi.search("zzzqqxnomatch");

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(Boolean)).toBe(true);
    expect(db.inTransaction).toBe(false);
  });

  test("an idle search opens no transaction", async () => {
    let ctx!: ModuleContext;
    await loadModules([recall(), patterns(), beacon(), probe(c => { ctx = c; })]);

    const beaconApi = ctx.beacon as { search(q: string): unknown; reindex(): void };
    beaconApi.reindex();
    beaconApi.search("nothing queued");        // no pending work
    expect(((ctx.recall as RecallAPI).db()).inTransaction).toBe(false);
  });
});
