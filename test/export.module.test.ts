import { describe, test, expect, beforeEach } from "bun:test";
import { handleRequest, _reset, loadModules } from "../src/mcp";
import recall from "../src/modules/recall";
import patterns from "../src/modules/patterns";
import scanner from "../src/modules/scanner";
import graphExport from "../src/modules/export";
import { resolve } from "path";

const FIXTURE_DIR = resolve(__dirname, "fixtures/scanner-project");

const rpc = (method: string, params?: unknown) =>
  handleRequest({ jsonrpc: "2.0", id: 1, method, params });

const callTool = async (name: string, args: Record<string, unknown>) => {
  const res = await rpc("tools/call", { name, arguments: args });
  return JSON.parse((res.result as any).content[0].text);
};

beforeEach(async () => {
  _reset();
  await loadModules([recall(), patterns(), scanner(), graphExport()]);
  await callTool("scanner_scan", { dir: FIXTURE_DIR });
});

describe("export module", () => {
  test("registers graph_export tool", async () => {
    const res = await rpc("tools/list");
    const names = (res.result as any).tools.map((t: any) => t.name);
    expect(names).toContain("graph_export");
  });

  // --- DOT format ---

  test("DOT output has digraph header and closing brace", async () => {
    const result = await callTool("graph_export", { format: "dot" });
    expect(result.output).toContain("digraph G {");
    expect(result.output).toContain("}");
    expect(result.format).toBe("dot");
  });

  test("DOT output uses correct shapes by type", async () => {
    const result = await callTool("graph_export", { format: "dot" });
    expect(result.output).toContain("shape=folder");    // file nodes
    expect(result.output).toContain("shape=ellipse");    // function nodes
    expect(result.output).toContain("shape=component");  // class nodes
    expect(result.output).toContain("shape=diamond");    // interface nodes
  });

  test("DOT output has edge labels", async () => {
    const result = await callTool("graph_export", { format: "dot" });
    expect(result.output).toContain('[label="defines"]');
    expect(result.output).toContain('[label="imports"]');
  });

  test("DOT with includeMetadata shows metadata in labels", async () => {
    const result = await callTool("graph_export", { format: "dot", includeMetadata: true });
    // complexHandler has complexity=7
    expect(result.output).toContain("complexity=");
  });

  // --- JSON format ---

  test("JSON output has nodes and edges arrays", async () => {
    const result = await callTool("graph_export", { format: "json" });
    expect(Array.isArray(result.nodes)).toBe(true);
    expect(Array.isArray(result.edges)).toBe(true);
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.edges.length).toBeGreaterThan(0);
  });

  test("JSON includes metadata by default", async () => {
    const result = await callTool("graph_export", { format: "json" });
    const fn = result.nodes.find((n: any) => n.name === "handleRequest");
    expect(fn).toBeTruthy();
    expect(fn.metadata).toBeDefined();
  });

  test("JSON without metadata strips it", async () => {
    const result = await callTool("graph_export", { format: "json", includeMetadata: false });
    const fn = result.nodes.find((n: any) => n.name === "handleRequest");
    expect(fn).toBeTruthy();
    expect(fn.metadata).toBeUndefined();
  });

  // --- Filters ---

  test("type filter limits to specific node type", async () => {
    const result = await callTool("graph_export", { format: "json", type: "function" });
    expect(result.nodes.every((n: any) => n.type === "function")).toBe(true);
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  test("relationship filter limits edges", async () => {
    const result = await callTool("graph_export", { format: "json", relationship: "calls" });
    expect(result.edges.every((e: any) => e.relationship === "calls")).toBe(true);
    // Only nodes connected by calls edges should remain
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.edges.length).toBeGreaterThan(0);
  });

  test("near filter scopes to subgraph", async () => {
    const full = await callTool("graph_export", { format: "json" });
    const near = await callTool("graph_export", {
      format: "json",
      near: { node: "utils/validate.ts", maxDepth: 1, direction: "outgoing" },
    });
    // Near should be a subset of full
    expect(near.nodes.length).toBeLessThan(full.nodes.length);
    expect(near.nodes.length).toBeGreaterThan(0);
  });

  test("near + type combined", async () => {
    const result = await callTool("graph_export", {
      format: "json",
      type: "function",
      near: { node: "server.ts", maxDepth: 1, direction: "outgoing" },
    });
    expect(result.nodes.every((n: any) => n.type === "function")).toBe(true);
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  // --- DOT filter ---

  test("DOT with type filter only includes filtered nodes", async () => {
    const result = await callTool("graph_export", { format: "dot", type: "class" });
    expect(result.output).toContain("shape=component");
    expect(result.output).not.toContain("shape=folder");
  });

  // --- API ---

  test("exposes export API on context", async () => {
    _reset();
    let apiRef: any;
    await loadModules([
      recall(), patterns(), graphExport(),
      {
        name: "consumer",
        depends: ["export"],
        init(ctx) { apiRef = ctx.export; },
      },
    ]);
    expect(apiRef).toBeDefined();
    expect(typeof apiRef.toDot).toBe("function");
    expect(typeof apiRef.toJSON).toBe("function");
  });
});
