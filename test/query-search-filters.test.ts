import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { loadModules, closeModules, _reset } from "../src/mcp";
import type { ModuleContext, ModuleMetadata } from "../src/mcp";
import recall from "../src/modules/recall";
import patterns from "../src/modules/patterns";
import beacon from "../src/modules/beacon";
import query from "../src/modules/query";
import type { RecallAPI } from "../src/modules/recall";
import type { PatternsAPI } from "../src/modules/patterns";
import type { BeaconAPI } from "../src/modules/beacon";
import type { QueryAPI } from "../src/modules/query";

let ctx!: ModuleContext;
const probe: ModuleMetadata = { name: "probe", depends: ["recall", "patterns", "beacon", "query"], init(c) { ctx = c; } };

const p = () => ctx.patterns as PatternsAPI;
const q = () => ctx.query as QueryAPI;

beforeEach(async () => {
  _reset();
  await loadModules([recall(), patterns(), beacon(), query(), probe]);

  // Three functions named handlerN, with complexity spread across the range.
  p().addNode("a.ts:handlerAlpha", "function", "handlerAlpha", { complexity: 9, exported: true, line: 10 });
  p().addNode("b.ts:handlerBeta", "function", "handlerBeta", { complexity: 2, exported: true, line: 20 });
  p().addNode("c.ts:handlerGamma", "function", "handlerGamma", { complexity: 7, exported: false, line: 30 });
  p().addNode("a.ts", "file", "a.ts", { functions: 1 });
  p().addEdge("a.ts", "a.ts:handlerAlpha", "defines");
  (ctx.beacon as BeaconAPI).reindex();
});
afterEach(async () => { await closeModules(); _reset(); });

const ids = (r: { results: { id: string }[] }) => r.results.map(x => x.id).sort();

describe("query_find combines search with the other filters", () => {
  test("search + where matches the same nodes as type + where", () => {
    const viaType = q().find({ type: "function", where: { complexity: { gt: 5 } }, limit: 50 });
    const viaSearch = q().find({ search: "handler", where: { complexity: { gt: 5 } }, limit: 50 });

    expect(ids(viaType)).toEqual(["a.ts:handlerAlpha", "c.ts:handlerGamma"]);
    expect(ids(viaSearch)).toEqual(ids(viaType));
  });

  test("search + an exact-match predicate works", () => {
    const res = q().find({ search: "handler", where: { exported: true }, limit: 50 });
    expect(ids(res)).toEqual(["a.ts:handlerAlpha", "b.ts:handlerBeta"]);
  });

  test("search + sort on a metadata field orders by that field", () => {
    const res = q().find({ search: "handler", sort: "complexity", limit: 50 });
    const complexities = res.results.map(r => (r.metadata as { complexity?: number })?.complexity);
    expect(complexities).toEqual([9, 7, 2]);
  });

  test("search + near intersects with the traversal", () => {
    const res = q().find({ search: "handler", near: { node: "a.ts", maxDepth: 1 }, limit: 50 });
    expect(ids(res)).toEqual(["a.ts:handlerAlpha"]);
  });

  test("metadata carries the node's own fields, not the node wrapper", () => {
    const res = q().find({ search: "handlerAlpha", limit: 5 });
    const hit = res.results.find(r => r.id === "a.ts:handlerAlpha");
    expect(hit).toBeDefined();
    expect(hit!.metadata).toEqual({ complexity: 9, exported: true, line: 10 });
    // The old shape nested the real metadata one level down.
    expect((hit!.metadata as Record<string, unknown>).metadata).toBeUndefined();
  });

  test("name is the node name in both branches", () => {
    const viaSearch = q().find({ search: "handlerAlpha", limit: 5 }).results.find(r => r.id === "a.ts:handlerAlpha");
    const viaType = q().find({ type: "function", limit: 50 }).results.find(r => r.id === "a.ts:handlerAlpha");
    expect(viaSearch!.name).toBe("handlerAlpha");
    expect(viaType!.name).toBe("handlerAlpha");
  });
});

describe("query_find over the other Beacon value shapes", () => {
  test("a recall hit exposes its stored object for predicates", () => {
    (ctx.recall as RecallAPI).set("deploy:last", { status: "green", attempts: 3 });
    (ctx.beacon as BeaconAPI).reindex();

    const res = q().find({ search: "green", where: { attempts: { gt: 2 } }, limit: 10 });
    expect(res.results.map(r => r.id)).toContain("deploy:last");
    const hit = res.results.find(r => r.id === "deploy:last")!;
    expect(hit.metadata).toEqual({ status: "green", attempts: 3 });
  });

  test("a recall hit holding a bare string yields no metadata rather than a broken one", () => {
    (ctx.recall as RecallAPI).set("motto:one", "avoid dependencies at all cost");
    (ctx.beacon as BeaconAPI).reindex();

    const res = q().find({ search: "dependencies", limit: 10 });
    const hit = res.results.find(r => r.id === "motto:one");
    expect(hit).toBeDefined();
    expect(hit!.metadata).toBeUndefined();
  });

  test("a note hit is named for its entity", () => {
    p().addNote("a.ts:handlerAlpha", "this one needs splitting up");
    (ctx.beacon as BeaconAPI).reindex();

    const res = q().find({ search: "splitting", limit: 10 });
    const hit = res.results.find(r => r.type === "note");
    expect(hit).toBeDefined();
    expect(hit!.name).toBe("a.ts:handlerAlpha");
  });

  test("a where predicate does not crash on a note or string hit", () => {
    p().addNote("a.ts:handlerAlpha", "needs splitting");
    (ctx.recall as RecallAPI).set("motto:two", "trained, not assembled");
    (ctx.beacon as BeaconAPI).reindex();

    const res = q().find({ search: "needs", where: { complexity: { gt: 1 } }, limit: 10 });
    expect(res.results.every(r => r.type !== "note")).toBe(true);
  });
});
