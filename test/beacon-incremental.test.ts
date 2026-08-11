import { describe, test, expect, beforeEach } from "bun:test";
import { handleRequest, _reset, loadModules } from "../src/mcp";
import type { PatternsAPI } from "../src/modules/patterns";
import recall from "../src/modules/recall";
import patterns from "../src/modules/patterns";
import beacon from "../src/modules/beacon";

const rpc = (method: string, params?: unknown) =>
  handleRequest({ jsonrpc: "2.0", id: 1, method, params });

const callTool = async (name: string, args: Record<string, unknown>) => {
  const res = await rpc("tools/call", { name, arguments: args });
  return JSON.parse((res.result as any).content[0].text);
};

let papi: PatternsAPI;

beforeEach(async () => {
  _reset();
  await loadModules([
    recall(), patterns(), beacon(),
    { name: "probe", depends: ["patterns"], init(ctx) { papi = ctx.patterns as PatternsAPI; } },
  ]);
});

describe("beacon incremental indexing", () => {
  test("indexes a node added after init without an explicit reindex", async () => {
    await callTool("patterns_add_node", { id: "n1", type: "function", name: "zappenstrum" });
    const result = await callTool("beacon_search", { query: "zappenstrum" });
    expect(result.results.some((r: any) => r.key === "n1")).toBe(true);
  });

  test("drops a node from the index when it is deleted", async () => {
    await callTool("patterns_add_node", { id: "n1", type: "function", name: "wibblefrump" });
    let result = await callTool("beacon_search", { query: "wibblefrump" });
    expect(result.results.some((r: any) => r.key === "n1")).toBe(true);

    papi.deleteNode("n1");
    result = await callTool("beacon_search", { query: "wibblefrump" });
    expect(result.results.some((r: any) => r.key === "n1")).toBe(false);
  });

  test("indexes a note added after init", async () => {
    await callTool("patterns_add_note", { entity: "e1", note: "flibbertigibbet handling" });
    const result = await callTool("beacon_search", { query: "flibbertigibbet" });
    expect(result.results.some((r: any) => r.type === "note")).toBe(true);
  });

  test("reflects an updated recall value incrementally", async () => {
    await callTool("recall_save", { key: "doc:1", value: "grobblewonk" });
    let result = await callTool("beacon_search", { query: "grobblewonk" });
    expect(result.count).toBeGreaterThanOrEqual(1);

    await callTool("recall_delete", { key: "doc:1" });
    result = await callTool("beacon_search", { query: "grobblewonk" });
    expect(result.results.some((r: any) => r.key === "doc:1")).toBe(false);
  });
});
