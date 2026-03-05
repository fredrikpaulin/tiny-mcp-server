import { describe, test, expect, beforeEach } from "bun:test";
import { handleRequest, _reset, loadModules } from "../src/mcp";
import recall from "../src/modules/recall";
import patterns from "../src/modules/patterns";
import beacon from "../src/modules/beacon";
import type { ModuleMetadata, ModuleContext } from "../src/mcp";

const rpc = (method: string, params?: unknown) =>
  handleRequest({ jsonrpc: "2.0", id: 1, method, params });

const callTool = async (name: string, args: Record<string, unknown>) => {
  const res = await rpc("tools/call", { name, arguments: args });
  return JSON.parse((res.result as any).content[0].text);
};

describe("event system", () => {
  beforeEach(() => _reset());

  test("ctx.on / ctx.emit delivers events", async () => {
    const received: unknown[] = [];
    const listener = (): ModuleMetadata => ({
      name: "listener",
      init(ctx) { ctx.on("test:ping", (...args) => received.push(args)); },
    });
    const emitter = (): ModuleMetadata => ({
      name: "emitter",
      depends: ["listener"],
      init(ctx) { ctx.emit("test:ping", "hello", 42); },
    });

    await loadModules([listener(), emitter()]);
    expect(received.length).toBe(1);
    expect(received[0]).toEqual(["hello", 42]);
  });

  test("ctx.off removes handler", async () => {
    let count = 0;
    const handler = () => { count++; };
    const mod = (): ModuleMetadata => ({
      name: "offtest",
      init(ctx) {
        ctx.on("tick", handler);
        ctx.emit("tick");
        ctx.emit("tick");
        ctx.off("tick", handler);
        ctx.emit("tick");
      },
    });

    await loadModules([mod()]);
    expect(count).toBe(2); // 3rd emit after off should not fire
  });

  test("multiple listeners on same event", async () => {
    const log: string[] = [];
    const mod = (): ModuleMetadata => ({
      name: "multi",
      init(ctx) {
        ctx.on("ev", () => log.push("a"));
        ctx.on("ev", () => log.push("b"));
        ctx.emit("ev");
      },
    });

    await loadModules([mod()]);
    expect(log).toEqual(["a", "b"]);
  });

  test("_reset clears event handlers", async () => {
    let called = false;
    const mod = (): ModuleMetadata => ({
      name: "resettest",
      init(ctx) { ctx.on("ev", () => { called = true; }); },
    });

    await loadModules([mod()]);
    _reset();

    // After reset, loading a module that emits should not trigger old handlers
    const emitter = (): ModuleMetadata => ({
      name: "emitter2",
      init(ctx) { ctx.emit("ev"); },
    });
    await loadModules([emitter()]);
    expect(called).toBe(false);
  });
});

describe("patterns emits events", () => {
  beforeEach(async () => {
    _reset();
  });

  test("emits patterns:nodeAdded on addNode", async () => {
    const events: unknown[] = [];
    const spy = (): ModuleMetadata => ({
      name: "spy",
      init(ctx) { ctx.on("patterns:nodeAdded", (data) => events.push(data)); },
    });

    await loadModules([recall(), spy(), patterns()]);
    await callTool("patterns_add_node", { id: "f1", type: "file", name: "test.ts" });
    expect(events.length).toBe(1);
    expect((events[0] as any).id).toBe("f1");
  });

  test("emits patterns:edgeAdded on addEdge", async () => {
    const events: unknown[] = [];
    const spy = (): ModuleMetadata => ({
      name: "spy",
      init(ctx) { ctx.on("patterns:edgeAdded", (data) => events.push(data)); },
    });

    await loadModules([recall(), spy(), patterns()]);
    await callTool("patterns_add_node", { id: "a", type: "fn", name: "a" });
    await callTool("patterns_add_node", { id: "b", type: "fn", name: "b" });
    await callTool("patterns_add_edge", { from: "a", to: "b", relationship: "calls" });
    expect(events.length).toBe(1);
    expect((events[0] as any).from).toBe("a");
  });

  test("emits patterns:noteAdded on addNote", async () => {
    const events: unknown[] = [];
    const spy = (): ModuleMetadata => ({
      name: "spy",
      init(ctx) { ctx.on("patterns:noteAdded", (data) => events.push(data)); },
    });

    await loadModules([recall(), spy(), patterns()]);
    await callTool("patterns_add_note", { entity: "x", note: "hello" });
    expect(events.length).toBe(1);
    expect((events[0] as any).entity).toBe("x");
  });
});

describe("recall emits events", () => {
  beforeEach(async () => {
    _reset();
  });

  test("emits recall:set on save", async () => {
    const events: unknown[] = [];
    const spy = (): ModuleMetadata => ({
      name: "spy",
      init(ctx) { ctx.on("recall:set", (data) => events.push(data)); },
    });

    await loadModules([spy(), recall()]);
    await callTool("recall_save", { key: "test", value: "data" });
    expect(events.length).toBe(1);
    expect((events[0] as any).key).toBe("test");
  });

  test("emits recall:delete on delete", async () => {
    const events: unknown[] = [];
    const spy = (): ModuleMetadata => ({
      name: "spy",
      init(ctx) { ctx.on("recall:delete", (data) => events.push(data)); },
    });

    await loadModules([spy(), recall()]);
    await callTool("recall_save", { key: "test", value: "data" });
    await callTool("recall_delete", { key: "test" });
    expect(events.length).toBe(1);
    expect((events[0] as any).key).toBe("test");
  });
});

describe("beacon auto-reindex via events", () => {
  beforeEach(async () => {
    _reset();
    await loadModules([recall(), patterns(), beacon()]);
  });

  test("search finds data without manual reindex", async () => {
    // Previously this required calling beacon_reindex after inserting data
    await callTool("recall_save", { key: "project:alpha", value: { name: "Alpha" } });

    const result = await callTool("beacon_search", { query: "alpha" });
    expect(result.count).toBeGreaterThanOrEqual(1);
    expect(result.results.some((r: any) => r.key.includes("alpha"))).toBe(true);
  });

  test("search finds new pattern nodes without manual reindex", async () => {
    await callTool("patterns_add_node", { id: "srv", type: "function", name: "serve" });

    const result = await callTool("beacon_search", { query: "serve" });
    expect(result.count).toBeGreaterThanOrEqual(1);
  });

  test("search finds new notes without manual reindex", async () => {
    await callTool("patterns_add_note", { entity: "comp", note: "handles authentication" });

    const result = await callTool("beacon_search", { query: "authentication" });
    expect(result.count).toBeGreaterThanOrEqual(1);
  });

  test("deleted recall entries disappear from search", async () => {
    await callTool("recall_save", { key: "temp-data", value: "transient" });
    // Confirm it's searchable
    const r1 = await callTool("beacon_search", { query: "temp-data" });
    expect(r1.count).toBeGreaterThanOrEqual(1);

    await callTool("recall_delete", { key: "temp-data" });
    const r2 = await callTool("beacon_search", { query: "temp-data" });
    expect(r2.count).toBe(0);
  });

  test("manual beacon_reindex still works", async () => {
    await callTool("recall_save", { key: "manual-test", value: "data" });
    await callTool("beacon_reindex", {});
    const result = await callTool("beacon_search", { query: "manual-test" });
    expect(result.count).toBeGreaterThanOrEqual(1);
  });
});

describe("modules:ready lifecycle event", () => {
  beforeEach(() => _reset());

  test("fires after all modules initialized", async () => {
    const order: string[] = [];
    const a = (): ModuleMetadata => ({
      name: "a",
      init(ctx) {
        order.push("a:init");
        ctx.on("modules:ready", () => order.push("a:ready"));
      },
    });
    const b = (): ModuleMetadata => ({
      name: "b",
      depends: ["a"],
      init(ctx) {
        order.push("b:init");
        ctx.on("modules:ready", () => order.push("b:ready"));
      },
    });

    await loadModules([a(), b()]);
    expect(order).toEqual(["a:init", "b:init", "a:ready", "b:ready"]);
  });

  test("beacon indexes data seeded during init", async () => {
    // A module that seeds data during init, before beacon's onReady fires
    const seeder = (): ModuleMetadata => ({
      name: "seeder",
      depends: ["recall", "patterns"],
      init(ctx) {
        const r = ctx.recall as any;
        r.set("seeded:item", { name: "Seeded Data" });
        const p = ctx.patterns as any;
        p.addNode("seeded-node", "config", "seeded-node");
      },
    });

    await loadModules([recall(), patterns(), seeder(), beacon()]);

    // Beacon's onReady should have picked up the seeded data
    const r1 = await callTool("beacon_search", { query: "seeded" });
    expect(r1.count).toBeGreaterThanOrEqual(1);
  });

  test("fires only once per loadModules call", async () => {
    let count = 0;
    const mod = (): ModuleMetadata => ({
      name: "counter",
      init(ctx) { ctx.on("modules:ready", () => count++); },
    });

    await loadModules([mod()]);
    expect(count).toBe(1);
  });
});
