import { describe, test, expect, beforeEach } from "bun:test";
import { handleRequest, _reset, loadModules, closeModules } from "../src/mcp";
import type { ModuleContext } from "../src/mcp";
import type { RecallAPI } from "../src/modules/recall";
import recall from "../src/modules/recall";

const rpc = (method: string, params?: unknown) =>
  handleRequest({ jsonrpc: "2.0", id: 1, method, params });

const callTool = async (name: string, args: Record<string, unknown>) => {
  const res = await rpc("tools/call", { name, arguments: args });
  return JSON.parse((res.result as any).content[0].text);
};

beforeEach(async () => {
  _reset();
  await loadModules([recall()]);
});

describe("recall module", () => {
  test("registers all 4 tools", async () => {
    const res = await rpc("tools/list");
    const names = (res.result as any).tools.map((t: any) => t.name);
    expect(names).toContain("recall_save");
    expect(names).toContain("recall_get");
    expect(names).toContain("recall_query");
    expect(names).toContain("recall_delete");
  });

  test("save and get round-trip", async () => {
    await callTool("recall_save", { key: "test", value: { x: 42 } });
    const result = await callTool("recall_get", { key: "test" });
    expect(result.found).toBe(true);
    expect(result.value).toEqual({ x: 42 });
  });

  test("get missing key returns found: false", async () => {
    const result = await callTool("recall_get", { key: "nonexistent" });
    expect(result.found).toBe(false);
    expect(result.value).toBeNull();
  });

  test("overwrite existing key", async () => {
    await callTool("recall_save", { key: "k", value: { v: 1 } });
    await callTool("recall_save", { key: "k", value: { v: 2 } });
    const result = await callTool("recall_get", { key: "k" });
    expect(result.value).toEqual({ v: 2 });
  });

  test("query with pattern", async () => {
    await callTool("recall_save", { key: "user:alice", value: { name: "Alice" } });
    await callTool("recall_save", { key: "user:bob", value: { name: "Bob" } });
    await callTool("recall_save", { key: "config:theme", value: { dark: true } });

    const result = await callTool("recall_query", { pattern: "user:%" });
    expect(result.count).toBe(2);
    expect(result.results["user:alice"]).toEqual({ name: "Alice" });
    expect(result.results["user:bob"]).toEqual({ name: "Bob" });
  });

  test("delete removes entry", async () => {
    await callTool("recall_save", { key: "temp", value: { data: true } });
    const del = await callTool("recall_delete", { key: "temp" });
    expect(del.ok).toBe(true);

    const result = await callTool("recall_get", { key: "temp" });
    expect(result.found).toBe(false);
  });

  test("stores string values", async () => {
    await callTool("recall_save", { key: "msg", value: "hello world" });
    const result = await callTool("recall_get", { key: "msg" });
    expect(result.value).toBe("hello world");
  });

  test("stores array values", async () => {
    await callTool("recall_save", { key: "list", value: [1, 2, 3] });
    const result = await callTool("recall_get", { key: "list" });
    expect(result.value).toEqual([1, 2, 3]);
  });
});

describe("recall namespace", () => {
  let api: RecallAPI;

  beforeEach(async () => {
    _reset();
    const mod = recall();
    const ctx = {} as ModuleContext;
    // Wire up registerTool as a no-op so init works outside loadModules
    ctx.registerTool = (() => {}) as any;
    mod.init(ctx);
    api = ctx.recall as RecallAPI;
  });

  test("namespaced set/get prefixes keys", () => {
    const ns = api.namespace("mymod");
    ns.set("key1", { x: 1 });
    // Accessible via namespace
    expect(ns.get("key1")).toEqual({ x: 1 });
    // Accessible via raw API with full prefix
    expect(api.get("mymod:key1")).toEqual({ x: 1 });
    // Not accessible without prefix
    expect(api.get("key1")).toBeNull();
  });

  test("namespaced query returns stripped keys", () => {
    const ns = api.namespace("users");
    ns.set("alice", { name: "Alice" });
    ns.set("bob", { name: "Bob" });
    api.set("other", { name: "Other" });

    const results = ns.query("%");
    expect(results).toHaveLength(2);
    // Keys should be stripped of prefix
    const keys = results.map(([k]) => k);
    expect(keys).toContain("alice");
    expect(keys).toContain("bob");
    expect(keys).not.toContain("users:alice");
  });

  test("namespaced delete only removes prefixed key", () => {
    const ns = api.namespace("temp");
    ns.set("a", 1);
    api.set("a", 2);

    ns.delete("a");
    expect(ns.get("a")).toBeNull();
    expect(api.get("a")).toBe(2); // raw key untouched
  });

  test("nested namespaces stack prefixes", () => {
    const deep = api.namespace("level1").namespace("level2");
    deep.set("val", "hello");

    expect(deep.get("val")).toBe("hello");
    expect(api.get("level1:level2:val")).toBe("hello");
    expect(api.namespace("level1").get("level2:val")).toBe("hello");
  });

  test("namespaces are isolated from each other", () => {
    const nsA = api.namespace("a");
    const nsB = api.namespace("b");
    nsA.set("key", "from-a");
    nsB.set("key", "from-b");

    expect(nsA.get("key")).toBe("from-a");
    expect(nsB.get("key")).toBe("from-b");
  });
});
