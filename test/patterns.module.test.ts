import { describe, test, expect, beforeEach } from "bun:test";
import { handleRequest, _reset, loadModules } from "../src/mcp";
import recall from "../src/modules/recall";
import patterns from "../src/modules/patterns";

const rpc = (method: string, params?: unknown) =>
  handleRequest({ jsonrpc: "2.0", id: 1, method, params });

const callTool = async (name: string, args: Record<string, unknown>) => {
  const res = await rpc("tools/call", { name, arguments: args });
  return JSON.parse((res.result as any).content[0].text);
};

beforeEach(async () => {
  _reset();
  await loadModules([recall(), patterns()]);
});

describe("patterns module", () => {
  test("registers all 4 tools", async () => {
    const res = await rpc("tools/list");
    const names = (res.result as any).tools.map((t: any) => t.name);
    expect(names).toContain("patterns_add_node");
    expect(names).toContain("patterns_add_edge");
    expect(names).toContain("patterns_query");
    expect(names).toContain("patterns_add_note");
  });

  test("add and query node", async () => {
    await callTool("patterns_add_node", { id: "mcp.ts", type: "file", name: "mcp.ts" });
    const result = await callTool("patterns_query", { nodeId: "mcp.ts" });
    expect(result.count).toBe(1);
    expect(result.results[0].node.name).toBe("mcp.ts");
  });

  test("add edge and query by relationship", async () => {
    await callTool("patterns_add_node", { id: "a", type: "file", name: "a.ts" });
    await callTool("patterns_add_node", { id: "b", type: "file", name: "b.ts" });
    await callTool("patterns_add_edge", { from: "a", to: "b", relationship: "imports" });

    const result = await callTool("patterns_query", { relationship: "imports" });
    expect(result.count).toBe(1);
    expect(result.results[0].from).toBe("a");
    expect(result.results[0].to).toBe("b");
  });

  test("query by type filters nodes", async () => {
    await callTool("patterns_add_node", { id: "f1", type: "file", name: "index.ts" });
    await callTool("patterns_add_node", { id: "fn1", type: "function", name: "serve" });

    const files = await callTool("patterns_query", { type: "file" });
    expect(files.count).toBe(1);
    expect(files.results[0].name).toBe("index.ts");

    const fns = await callTool("patterns_query", { type: "function" });
    expect(fns.count).toBe(1);
    expect(fns.results[0].name).toBe("serve");
  });

  test("query all returns all nodes", async () => {
    await callTool("patterns_add_node", { id: "x", type: "file", name: "x.ts" });
    await callTool("patterns_add_node", { id: "y", type: "file", name: "y.ts" });
    const result = await callTool("patterns_query", {});
    expect(result.count).toBe(2);
  });

  test("add and retrieve notes", async () => {
    await callTool("patterns_add_node", { id: "comp", type: "module", name: "component" });
    await callTool("patterns_add_note", { entity: "comp", note: "Needs refactoring" });
    await callTool("patterns_add_note", { entity: "comp", note: "Has tech debt" });

    const result = await callTool("patterns_query", { nodeId: "comp" });
    expect(result.results[0].notes).toHaveLength(2);
    expect(result.results[0].notes[0].text).toBe("Needs refactoring");
    expect(result.results[0].notes[1].text).toBe("Has tech debt");
  });

  test("node with edges returns full context", async () => {
    await callTool("patterns_add_node", { id: "a", type: "file", name: "a.ts" });
    await callTool("patterns_add_node", { id: "b", type: "file", name: "b.ts" });
    await callTool("patterns_add_edge", { from: "a", to: "b", relationship: "imports" });
    await callTool("patterns_add_note", { entity: "a", note: "Entry point" });

    const result = await callTool("patterns_query", { nodeId: "a" });
    expect(result.results[0].node.id).toBe("a");
    expect(result.results[0].edges.length).toBeGreaterThanOrEqual(1);
    expect(result.results[0].notes).toHaveLength(1);
  });

  test("node metadata is preserved", async () => {
    await callTool("patterns_add_node", {
      id: "srv", type: "function", name: "serve",
      metadata: { line: 333, exported: true },
    });
    const result = await callTool("patterns_query", { nodeId: "srv" });
    expect(result.results[0].node.metadata).toEqual({ line: 333, exported: true });
  });
});
