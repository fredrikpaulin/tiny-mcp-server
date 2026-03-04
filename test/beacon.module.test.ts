import { describe, test, expect, beforeEach } from "bun:test";
import { handleRequest, _reset, loadModules } from "../src/mcp";
import recall from "../src/modules/recall";
import patterns from "../src/modules/patterns";
import beacon from "../src/modules/beacon";

const rpc = (method: string, params?: unknown) =>
  handleRequest({ jsonrpc: "2.0", id: 1, method, params });

const callTool = async (name: string, args: Record<string, unknown>) => {
  const res = await rpc("tools/call", { name, arguments: args });
  return JSON.parse((res.result as any).content[0].text);
};

beforeEach(async () => {
  _reset();
  await loadModules([recall(), patterns(), beacon()]);
});

describe("beacon module", () => {
  test("registers beacon_search tool", async () => {
    const res = await rpc("tools/list");
    const names = (res.result as any).tools.map((t: any) => t.name);
    expect(names).toContain("beacon_search");
  });

  test("finds recall entries by key", async () => {
    await callTool("recall_save", { key: "project:alpha", value: { name: "Alpha" } });
    await callTool("recall_save", { key: "project:beta", value: { name: "Beta" } });

    const result = await callTool("beacon_search", { query: "alpha" });
    expect(result.count).toBeGreaterThanOrEqual(1);
    expect(result.results.some((r: any) => r.key.includes("alpha"))).toBe(true);
  });

  test("finds pattern nodes by name", async () => {
    await callTool("patterns_add_node", { id: "srv", type: "function", name: "serve" });
    await callTool("patterns_add_node", { id: "val", type: "function", name: "validate" });

    const result = await callTool("beacon_search", { query: "serve" });
    expect(result.count).toBeGreaterThanOrEqual(1);
    expect(result.results.some((r: any) => r.type === "function")).toBe(true);
  });

  test("finds notes containing search text", async () => {
    await callTool("patterns_add_note", { entity: "comp", note: "This component handles authentication" });

    const result = await callTool("beacon_search", { query: "authentication" });
    expect(result.count).toBeGreaterThanOrEqual(1);
    expect(result.results.some((r: any) => r.type === "note")).toBe(true);
  });

  test("results are sorted by score (exact > partial)", async () => {
    await callTool("recall_save", { key: "serve", value: { exact: true } });
    await callTool("recall_save", { key: "server-config", value: { partial: true } });

    const result = await callTool("beacon_search", { query: "serve" });
    expect(result.results[0].score).toBeGreaterThanOrEqual(result.results[1]?.score || 0);
  });

  test("maxResults limits output", async () => {
    for (let i = 0; i < 10; i++) {
      await callTool("recall_save", { key: `item:${i}`, value: { i } });
    }
    const result = await callTool("beacon_search", { query: "item", maxResults: 3 });
    expect(result.count).toBeLessThanOrEqual(3);
  });

  test("empty results for no match", async () => {
    await callTool("recall_save", { key: "hello", value: {} });
    const result = await callTool("beacon_search", { query: "zzzzz" });
    expect(result.count).toBe(0);
  });

  test("type filter narrows results", async () => {
    await callTool("patterns_add_node", { id: "f1", type: "file", name: "server.ts" });
    await callTool("patterns_add_node", { id: "fn1", type: "function", name: "serverInit" });

    const result = await callTool("beacon_search", { query: "server", types: ["file"] });
    for (const r of result.results) {
      expect(r.type).toBe("file");
    }
  });
});
