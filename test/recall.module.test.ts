import { describe, test, expect, beforeEach } from "bun:test";
import { handleRequest, _reset, loadModules, closeModules } from "../src/mcp";
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
