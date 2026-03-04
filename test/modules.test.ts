import { describe, test, expect, beforeEach } from "bun:test";
import { handleRequest, _reset, loadModules, closeModules } from "../src/mcp";
import type { ModuleMetadata } from "../src/mcp";

const rpc = (method: string, params?: unknown) =>
  handleRequest({ jsonrpc: "2.0", id: 1, method, params });

beforeEach(() => {
  _reset();
});

describe("loadModules", () => {
  test("loads a single module", async () => {
    const mod: ModuleMetadata = {
      name: "test",
      init(ctx) {
        ctx.registerTool("test_tool", "A test tool", { type: "object" }, async () => ({ ok: true }));
      },
    };
    await loadModules([mod]);
    const res = await rpc("tools/list");
    const names = (res.result as any).tools.map((t: any) => t.name);
    expect(names).toContain("test_tool");
  });

  test("resolves dependencies in topological order", async () => {
    const order: string[] = [];
    const a: ModuleMetadata = { name: "a", init: () => { order.push("a"); } };
    const b: ModuleMetadata = { name: "b", depends: ["a"], init: () => { order.push("b"); } };
    const c: ModuleMetadata = { name: "c", depends: ["b"], init: () => { order.push("c"); } };

    await loadModules([c, b, a]); // intentionally wrong order
    expect(order).toEqual(["a", "b", "c"]);
  });

  test("passes shared context between modules", async () => {
    const a: ModuleMetadata = {
      name: "a",
      init(ctx) { ctx.shared = 42; },
    };
    const b: ModuleMetadata = {
      name: "b",
      depends: ["a"],
      init(ctx) {
        ctx.registerTool("check", "Check shared", { type: "object" }, async () => ({ value: ctx.shared }));
      },
    };
    await loadModules([b, a]);
    const res = await rpc("tools/call", { name: "check", arguments: {} });
    const parsed = JSON.parse((res.result as any).content[0].text);
    expect(parsed.value).toBe(42);
  });

  test("throws on circular dependencies", async () => {
    const a: ModuleMetadata = { name: "a", depends: ["b"], init() {} };
    const b: ModuleMetadata = { name: "b", depends: ["a"], init() {} };
    expect(loadModules([a, b])).rejects.toThrow(/Circular/);
  });

  test("throws on missing dependency", async () => {
    const mod: ModuleMetadata = { name: "test", depends: ["missing"], init() {} };
    expect(loadModules([mod])).rejects.toThrow(/Missing module: missing/);
  });

  test("wraps init errors with module name", async () => {
    const mod: ModuleMetadata = {
      name: "broken",
      init() { throw new Error("boom"); },
    };
    expect(loadModules([mod])).rejects.toThrow(/Failed to initialize module "broken": boom/);
  });

  test("supports async init", async () => {
    const mod: ModuleMetadata = {
      name: "async-mod",
      async init(ctx) {
        await new Promise(r => setTimeout(r, 5));
        ctx.registerTool("delayed", "Delayed tool", { type: "object" }, async () => ({ ok: true }));
      },
    };
    await loadModules([mod]);
    const res = await rpc("tools/list");
    const names = (res.result as any).tools.map((t: any) => t.name);
    expect(names).toContain("delayed");
  });
});

describe("closeModules", () => {
  test("calls close hooks in reverse order", async () => {
    const order: string[] = [];
    const a: ModuleMetadata = { name: "a", init() {}, close() { order.push("a"); } };
    const b: ModuleMetadata = { name: "b", depends: ["a"], init() {}, close() { order.push("b"); } };
    const c: ModuleMetadata = { name: "c", depends: ["b"], init() {}, close() { order.push("c"); } };

    await loadModules([a, b, c]);
    await closeModules();
    expect(order).toEqual(["c", "b", "a"]);
  });

  test("skips modules without close hook", async () => {
    const order: string[] = [];
    const a: ModuleMetadata = { name: "a", init() {}, close() { order.push("a"); } };
    const b: ModuleMetadata = { name: "b", depends: ["a"], init() {} }; // no close
    await loadModules([a, b]);
    await closeModules();
    expect(order).toEqual(["a"]);
  });
});

describe("_reset clears module state", () => {
  test("allows reloading modules after reset", async () => {
    const mod: ModuleMetadata = {
      name: "reloadable",
      init(ctx) {
        ctx.registerTool("reload_tool", "Test", { type: "object" }, async () => ({ ok: true }));
      },
    };
    await loadModules([mod]);
    _reset();
    // Should be able to load again without "already loaded" error
    await loadModules([mod]);
    const res = await rpc("tools/list");
    const names = (res.result as any).tools.map((t: any) => t.name);
    expect(names).toContain("reload_tool");
  });
});
