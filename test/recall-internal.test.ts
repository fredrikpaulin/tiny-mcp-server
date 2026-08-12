import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { loadModules, closeModules, _reset, handleRequest } from "../src/mcp";
import type { ModuleContext, ModuleMetadata } from "../src/mcp";
import { Database } from "bun:sqlite";
import recall from "../src/modules/recall";
import patterns from "../src/modules/patterns";
import beacon from "../src/modules/beacon";
import scanner from "../src/modules/scanner";
import prompt from "../src/modules/prompt";
import graphExport from "../src/modules/export";
import diff from "../src/modules/diff";
import type { RecallAPI } from "../src/modules/recall";
import type { BeaconAPI } from "../src/modules/beacon";
import type { ScannerAPI } from "../src/modules/scanner";
import { unlinkSync } from "node:fs";
import { join } from "path";

const FIXTURE = join(import.meta.dir, "fixtures", "scanner-project");
const DB = "/tmp/tiny-mcp-recall-internal.db";

function removeDb() {
  for (const s of ["", "-wal", "-shm"]) { try { unlinkSync(DB + s); } catch { /* absent */ } }
}

let ctx!: ModuleContext;
const probe: ModuleMetadata = {
  name: "probe",
  depends: ["recall", "patterns", "beacon", "scanner", "prompt", "diff"],
  init(c) { ctx = c; },
};

const stack = (dbPath?: string) =>
  [recall(dbPath ? { dbPath } : {}), patterns(), beacon(), scanner(), prompt(), graphExport(), diff(), probe];

beforeEach(() => { _reset(); removeDb(); });
afterEach(async () => { await closeModules(); _reset(); removeDb(); });

describe("recall.internal", () => {
  test("keeps internal writes out of the public store", async () => {
    await loadModules(stack());
    const r = ctx.recall as RecallAPI;
    const store = r.internal("mymodule");

    store.set("hash:a.ts", "abc123");
    r.set("user:1", { name: "Fredrik" });

    expect(store.get("hash:a.ts")).toBe("abc123");
    // Not present under any pattern on the public store.
    expect(r.query("%").map(([k]) => k)).toEqual(["user:1"]);
    expect(r.query("mymodule:%")).toEqual([]);
    expect(r.get("mymodule:hash:a.ts")).toBeNull();
  });

  test("emits no events", async () => {
    await loadModules(stack());
    const r = ctx.recall as RecallAPI;
    const events: string[] = [];
    ctx.on("recall:set", (p: any) => events.push(`set:${p.key}`));
    ctx.on("recall:delete", (p: any) => events.push(`delete:${p.key}`));

    const store = r.internal("quiet");
    store.set("a", 1);
    store.delete("a");
    expect(events).toEqual([]);

    r.set("loud", 1);
    r.delete("loud");
    expect(events).toEqual(["set:loud", "delete:loud"]);
  });

  test("supports the full RecallAPI shape, including nesting", async () => {
    await loadModules(stack());
    const store = (ctx.recall as RecallAPI).internal("outer");

    store.set("x", 1);
    const nested = store.namespace("inner");
    nested.set("y", 2);

    expect(store.get("x")).toBe(1);
    expect(nested.get("y")).toBe(2);
    expect(store.query("%").map(([k]) => k).sort()).toEqual(["inner:y", "x"]);
    // A nested namespace of an internal store stays internal.
    expect((ctx.recall as RecallAPI).query("%")).toEqual([]);
  });

  test("delete removes only the addressed key", async () => {
    await loadModules(stack());
    const store = (ctx.recall as RecallAPI).internal("m");
    store.set("a", 1);
    store.set("b", 2);
    store.delete("a");
    expect(store.get("a")).toBeNull();
    expect(store.get("b")).toBe(2);
  });
});

describe("module bookkeeping stays out of the search index", () => {
  test("a scan indexes no scanner internals, before or after a reindex", async () => {
    await loadModules(stack());
    const db = (ctx.recall as RecallAPI).db();
    await (ctx.scanner as ScannerAPI).scan(FIXTURE);

    const internalDocs = () => (db.prepare(
      `SELECT count(*) c FROM beacon_fts WHERE key LIKE 'scanner:%' OR key LIKE 'prompt:%' OR key LIKE 'diff:%'`
    ).get() as { c: number }).c;

    // Event-driven path: the flush that a search performs.
    (ctx.beacon as BeaconAPI).search("validate");
    expect(internalDocs()).toBe(0);

    // Full-rebuild path. This is the one a silent-event flag would have missed,
    // because reindex reads the recall table directly rather than via events.
    (ctx.beacon as BeaconAPI).reindex();
    expect(internalDocs()).toBe(0);

    // And the real graph is still indexed.
    expect((db.prepare(`SELECT count(*) c FROM beacon_fts`).get() as { c: number }).c).toBeGreaterThan(0);
  });

  test("search results contain no module bookkeeping", async () => {
    await loadModules(stack());
    await (ctx.scanner as ScannerAPI).scan(FIXTURE);
    (ctx.beacon as BeaconAPI).reindex();

    for (const q of ["validate", "slice", "hash", "utils"]) {
      const keys = (ctx.beacon as BeaconAPI).search(q, { maxResults: 100 }).results.map(r => r.key);
      expect(keys.filter(k => k.startsWith("scanner:") || k.startsWith("prompt:") || k.startsWith("diff:"))).toEqual([]);
    }
  });

  test("recall_query does not expose module bookkeeping to the consumer", async () => {
    await loadModules(stack());
    await (ctx.scanner as ScannerAPI).scan(FIXTURE);

    const res = await handleRequest({
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "recall_query", arguments: { pattern: "%" } },
    }) as any;
    const payload = JSON.parse(res.result.content[0].text);
    expect(Object.keys(payload.results).filter(k => k.startsWith("scanner:"))).toEqual([]);
  });

  test("a consumer key beginning with patterns: is still searchable", async () => {
    await loadModules(stack());
    (ctx.recall as RecallAPI).set("patterns:my-own-note", "a legitimate consumer key");
    (ctx.beacon as BeaconAPI).reindex();

    const keys = (ctx.beacon as BeaconAPI).search("legitimate", { maxResults: 10 }).results.map(r => r.key);
    expect(keys).toContain("patterns:my-own-note");
  });
});

describe("migration from earlier databases", () => {
  test("adopts bookkeeping keys that an older version left in recall_data", async () => {
    // Simulate a database written before recall_internal existed.
    const seed = new Database(DB);
    seed.exec(`CREATE TABLE IF NOT EXISTS recall_data (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
    const now = Date.now();
    const ins = seed.prepare(`INSERT INTO recall_data (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)`);
    ins.run("scanner:hash:old.ts", JSON.stringify("stale-hash"), now, now);
    ins.run("scanner:slice:old.ts", JSON.stringify({ nodes: [], edges: [] }), now, now);
    ins.run("user:keep-me", JSON.stringify({ mine: true }), now, now);
    seed.close();

    await loadModules(stack(DB));
    const r = ctx.recall as RecallAPI;
    const db = r.db();

    // Moved, not copied.
    expect(r.query("%").map(([k]) => k)).toEqual(["user:keep-me"]);
    expect((db.prepare(`SELECT count(*) c FROM recall_data WHERE substr(key,1,8) = 'scanner:'`).get() as { c: number }).c).toBe(0);

    // Still readable through the internal store, with values intact.
    const cache = r.internal("scanner");
    expect(cache.get("hash:old.ts")).toBe("stale-hash");

    // The consumer's key is untouched.
    expect(r.get("user:keep-me")).toEqual({ mine: true });
  });

  test("a prefix containing a LIKE wildcard does not widen the migration", async () => {
    const seed = new Database(DB);
    seed.exec(`CREATE TABLE IF NOT EXISTS recall_data (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
    const now = Date.now();
    const ins = seed.prepare(`INSERT INTO recall_data (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)`);
    // "a_c" as a LIKE pattern would also match "abc".
    ins.run("a_c:mine", JSON.stringify("internal"), now, now);
    ins.run("abc:mine", JSON.stringify("consumer data"), now, now);
    seed.close();

    await loadModules(stack(DB));
    const r = ctx.recall as RecallAPI;
    r.internal("a_c");

    expect(r.get("abc:mine")).toBe("consumer data");
    expect(r.query("%").map(([k]) => k)).toEqual(["abc:mine"]);
  });
});
