import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { loadModules, closeModules, _reset } from "../src/mcp";
import type { ModuleContext, ModuleMetadata } from "../src/mcp";
import recall from "../src/modules/recall";
import patterns from "../src/modules/patterns";
import beacon from "../src/modules/beacon";
import type { PatternsAPI } from "../src/modules/patterns";
import type { BeaconAPI } from "../src/modules/beacon";

let ctx!: ModuleContext;
const probe: ModuleMetadata = { name: "probe", depends: ["recall", "patterns", "beacon"], init(c) { ctx = c; } };

beforeEach(async () => { _reset(); await loadModules([recall(), patterns(), beacon(), probe]); });
afterEach(async () => { await closeModules(); _reset(); });

describe("beacon.search timing", () => {
  test("total_ms accounts for the index work the call performs", () => {
    const p = ctx.patterns as PatternsAPI;
    const b = ctx.beacon as BeaconAPI;
    b.reindex();

    // Queue enough work that the flush is the dominant cost of the next search.
    for (let i = 0; i < 1000; i++) p.addNode(`m${i}.ts:handler${i}`, "function", `handler${i}`);

    const before = performance.now();
    const res = b.search("handler1");
    const wall = performance.now() - before;

    expect(res.timing.total_ms).toBeGreaterThan(0);
    // The reported figure used to exclude the flush entirely, reporting single-digit
    // milliseconds for a call that took orders of magnitude longer.
    expect(res.timing.total_ms).toBeGreaterThan(wall * 0.8);
    expect(res.timing.total_ms).toBeLessThan(wall * 1.2);
  }, 30_000);

  test("index_ms reports the flush and is most of a first search", () => {
    const p = ctx.patterns as PatternsAPI;
    const b = ctx.beacon as BeaconAPI;
    b.reindex();
    for (let i = 0; i < 1000; i++) p.addNode(`m${i}.ts:fn${i}`, "function", `fn${i}`);

    const res = b.search("fn1");
    expect(res.timing.index_ms).toBeGreaterThan(0);
    expect(res.timing.index_ms).toBeGreaterThan(res.timing.query_ms);
  }, 30_000);

  test("a warm search reports almost no index time", () => {
    const p = ctx.patterns as PatternsAPI;
    const b = ctx.beacon as BeaconAPI;
    b.reindex();
    p.addNode("a.ts:alpha", "function", "alpha");
    b.search("alpha");            // drains the queue

    const res = b.search("alpha");
    expect(res.timing.index_ms).toBe(0);
  });

  test("the three figures decompose the call", () => {
    const p = ctx.patterns as PatternsAPI;
    const b = ctx.beacon as BeaconAPI;
    b.reindex();
    for (let i = 0; i < 200; i++) p.addNode(`m${i}.ts:beta${i}`, "function", `beta${i}`);

    const res = b.search("beta7");
    expect(res.timing.query_ms).toBeLessThanOrEqual(res.timing.total_ms);
    expect(res.timing.index_ms).toBeLessThanOrEqual(res.timing.total_ms);
    // Rounding to two decimals can add up to 0.02 ms of slack across three fields.
    expect(res.timing.index_ms + res.timing.query_ms).toBeLessThanOrEqual(res.timing.total_ms + 0.02);
  });

  test("a query that sanitizes to nothing still reports its index time", () => {
    const p = ctx.patterns as PatternsAPI;
    const b = ctx.beacon as BeaconAPI;
    b.reindex();
    for (let i = 0; i < 200; i++) p.addNode(`m${i}.ts:gamma${i}`, "function", `gamma${i}`);

    // Only FTS operators, so sanitize() strips it to an empty string.
    const res = b.search("AND OR NOT");
    expect(res.results).toEqual([]);
    expect(res.timing.query_ms).toBe(0);
    expect(res.timing.total_ms).toBe(res.timing.index_ms);
    expect(res.timing.index_ms).toBeGreaterThan(0);
  });

  test("the tool result carries all three fields", async () => {
    const { handleRequest } = await import("../src/mcp");
    (ctx.beacon as BeaconAPI).reindex();
    (ctx.patterns as PatternsAPI).addNode("a.ts:delta", "function", "delta");

    const res = await handleRequest({
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "beacon_search", arguments: { query: "delta" } },
    }) as any;
    const payload = JSON.parse(res.result.content[0].text);
    expect(Object.keys(payload.timing).sort()).toEqual(["index_ms", "query_ms", "total_ms"]);
  });
});
