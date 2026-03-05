import { describe, test, expect, beforeEach } from "bun:test";
import { handleRequest, _reset, loadModules } from "../src/mcp";
import recall from "../src/modules/recall";
import patterns from "../src/modules/patterns";
import beacon from "../src/modules/beacon";
import scanner from "../src/modules/scanner";
import query from "../src/modules/query";
import { resolve } from "path";

const FIXTURE_DIR = resolve(__dirname, "fixtures/scanner-project");

const rpc = (method: string, params?: unknown) =>
  handleRequest({ jsonrpc: "2.0", id: 1, method, params });

const callTool = async (name: string, args: Record<string, unknown>) => {
  const res = await rpc("tools/call", { name, arguments: args });
  return JSON.parse((res.result as any).content[0].text);
};

// Load all modules + scan fixture dir before each test
beforeEach(async () => {
  _reset();
  await loadModules([recall(), patterns(), beacon(), scanner(), query()]);
  await callTool("scanner_scan", { dir: FIXTURE_DIR });
  await callTool("beacon_reindex", {});
});

describe("query module", () => {
  test("registers query_find tool", async () => {
    const res = await rpc("tools/list");
    const names = (res.result as any).tools.map((t: any) => t.name);
    expect(names).toContain("query_find");
  });

  test("find by type", async () => {
    const result = await callTool("query_find", { type: "function" });
    expect(result.count).toBeGreaterThan(0);
    expect(result.results.every((r: any) => r.type === "function")).toBe(true);
    expect(result.timing_ms).toBeGreaterThanOrEqual(0);
  });

  test("find by type: interface", async () => {
    const result = await callTool("query_find", { type: "interface" });
    expect(result.count).toBeGreaterThanOrEqual(2);
    const names = result.results.map((r: any) => r.name);
    expect(names).toContain("Serializable");
    expect(names).toContain("Cacheable");
  });

  test("where: exact match", async () => {
    const result = await callTool("query_find", {
      type: "function",
      where: { exported: true },
    });
    expect(result.count).toBeGreaterThan(0);
    expect(result.results.every((r: any) => r.metadata?.exported === true)).toBe(true);
  });

  test("where: gt operator", async () => {
    const result = await callTool("query_find", {
      type: "function",
      where: { complexity: { gt: 3 } },
    });
    expect(result.count).toBeGreaterThanOrEqual(1);
    expect(result.results.every((r: any) => r.metadata?.complexity > 3)).toBe(true);
    // complexHandler should be in results
    expect(result.results.some((r: any) => r.name === "complexHandler")).toBe(true);
  });

  test("where: lt operator", async () => {
    const result = await callTool("query_find", {
      type: "function",
      where: { complexity: { lt: 2 } },
    });
    expect(result.count).toBeGreaterThan(0);
    expect(result.results.every((r: any) => r.metadata?.complexity < 2)).toBe(true);
  });

  test("where: exists operator", async () => {
    const result = await callTool("query_find", {
      type: "function",
      where: { returnType: { exists: true } },
    });
    // Functions with explicit return types
    for (const r of result.results) {
      expect(r.metadata?.returnType).toBeTruthy();
    }
  });

  test("near: proximity filter", async () => {
    const result = await callTool("query_find", {
      near: { node: "server.ts", maxDepth: 1, direction: "outgoing" },
    });
    expect(result.count).toBeGreaterThan(0);
    // Should include server.ts itself and its direct outgoing neighbors
    const ids = result.results.map((r: any) => r.id);
    expect(ids).toContain("server.ts");
  });

  test("near + type combined", async () => {
    const result = await callTool("query_find", {
      type: "function",
      near: { node: "server.ts", maxDepth: 1, direction: "outgoing" },
    });
    expect(result.count).toBeGreaterThan(0);
    expect(result.results.every((r: any) => r.type === "function")).toBe(true);
    // handleRequest is defined in server.ts
    expect(result.results.some((r: any) => r.name === "handleRequest")).toBe(true);
  });

  test("near + where combined", async () => {
    const result = await callTool("query_find", {
      type: "function",
      near: { node: "server.ts", maxDepth: 1, direction: "outgoing" },
      where: { complexity: { gt: 3 } },
    });
    // Only complexHandler has high complexity in server.ts
    expect(result.count).toBeGreaterThanOrEqual(1);
    expect(result.results.some((r: any) => r.name === "complexHandler")).toBe(true);
  });

  test("relationship filter", async () => {
    const result = await callTool("query_find", {
      type: "function",
      relationship: "has_effect",
    });
    // fetchData has a network effect, start has console effect
    expect(result.count).toBeGreaterThanOrEqual(1);
  });

  test("sort by metadata field", async () => {
    const result = await callTool("query_find", {
      type: "function",
      sort: "complexity",
    });
    expect(result.count).toBeGreaterThan(1);
    // Should be sorted descending by complexity
    for (let i = 1; i < result.results.length; i++) {
      const prev = result.results[i - 1].metadata?.complexity ?? 0;
      const curr = result.results[i].metadata?.complexity ?? 0;
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });

  test("limit caps results", async () => {
    const result = await callTool("query_find", {
      type: "function",
      limit: 2,
    });
    expect(result.count).toBeLessThanOrEqual(2);
  });

  test("text search via beacon", async () => {
    const result = await callTool("query_find", {
      search: "validate",
    });
    expect(result.count).toBeGreaterThan(0);
    // Results should have scores from beacon
    expect(result.results[0].score).toBeGreaterThan(0);
  });

  test("text search + type filter", async () => {
    const result = await callTool("query_find", {
      search: "validate",
      type: "function",
    });
    expect(result.count).toBeGreaterThan(0);
    expect(result.results.every((r: any) => r.type === "function")).toBe(true);
  });

  test("all nodes when no filters", async () => {
    const result = await callTool("query_find", {});
    expect(result.count).toBeGreaterThan(0);
  });

  test("exposes query API on context", async () => {
    _reset();
    let apiRef: any;
    await loadModules([
      recall(), patterns(), query(),
      {
        name: "consumer",
        depends: ["query"],
        init(ctx) { apiRef = ctx.query; },
      },
    ]);
    expect(apiRef).toBeDefined();
    expect(typeof apiRef.find).toBe("function");
  });
});
