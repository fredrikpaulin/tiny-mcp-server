import { describe, test, expect, beforeEach } from "bun:test";
import { handleRequest, _reset, loadModules } from "../src/mcp";
import recall from "../src/modules/recall";
import patterns from "../src/modules/patterns";
import scanner from "../src/modules/scanner";
import graphExport from "../src/modules/export";
import stats from "../src/modules/stats";
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
  await loadModules([recall(), patterns(), scanner(), graphExport(), stats()]);
  await callTool("scanner_scan", { dir: FIXTURE_DIR });
});

describe("stats module", () => {
  test("registers graph_stats tool", async () => {
    const res = await rpc("tools/list");
    const names = (res.result as any).tools.map((t: any) => t.name);
    expect(names).toContain("graph_stats");
  });

  test("returns node counts by type", async () => {
    const result = await callTool("graph_stats", {});
    expect(result.totalNodes).toBeGreaterThan(0);
    expect(result.nodesByType.file).toBeGreaterThan(0);
    expect(result.nodesByType.function).toBeGreaterThan(0);
  });

  test("returns edge counts by relationship", async () => {
    const result = await callTool("graph_stats", {});
    expect(result.totalEdges).toBeGreaterThan(0);
    expect(result.edgesByRelationship.defines).toBeGreaterThan(0);
  });

  test("computes complexity stats", async () => {
    const result = await callTool("graph_stats", {});
    expect(result.avgComplexity).toBeGreaterThan(0);
    expect(result.maxComplexity).not.toBeNull();
    expect(result.maxComplexity.value).toBeGreaterThanOrEqual(1);
  });

  test("most connected nodes are sorted by degree", async () => {
    const result = await callTool("graph_stats", {});
    expect(result.mostConnected.length).toBeGreaterThan(0);
    for (let i = 1; i < result.mostConnected.length; i++) {
      expect(result.mostConnected[i - 1].degree).toBeGreaterThanOrEqual(result.mostConnected[i].degree);
    }
  });

  test("hotspots combine complexity and connectivity", async () => {
    const result = await callTool("graph_stats", {});
    expect(result.hotspots.length).toBeGreaterThan(0);
    for (let i = 1; i < result.hotspots.length; i++) {
      expect(result.hotspots[i - 1].score).toBeGreaterThanOrEqual(result.hotspots[i].score);
    }
  });

  test("maxDepth reflects import chain depth", async () => {
    const result = await callTool("graph_stats", {});
    // Fixture has at least server.ts → utils/validate.ts import chain
    expect(result.maxDepth).toBeGreaterThanOrEqual(1);
  });

  test("empty graph returns zeroes", async () => {
    _reset();
    await loadModules([recall(), patterns(), graphExport(), stats()]);
    const result = await callTool("graph_stats", {});
    expect(result.totalNodes).toBe(0);
    expect(result.totalEdges).toBe(0);
    expect(result.avgComplexity).toBe(0);
    expect(result.maxComplexity).toBeNull();
    expect(result.mostConnected).toEqual([]);
    expect(result.hotspots).toEqual([]);
    expect(result.maxDepth).toBe(0);
  });

  test("exposes stats API on context", async () => {
    _reset();
    let apiRef: any;
    await loadModules([
      recall(), patterns(), graphExport(), stats(),
      {
        name: "consumer",
        depends: ["stats"],
        init(ctx) { apiRef = ctx.stats; },
      },
    ]);
    expect(apiRef).toBeDefined();
    expect(typeof apiRef.compute).toBe("function");
  });
});
