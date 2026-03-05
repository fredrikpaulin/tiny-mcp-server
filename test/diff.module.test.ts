import { describe, test, expect, beforeEach } from "bun:test";
import { handleRequest, _reset, loadModules } from "../src/mcp";
import recall from "../src/modules/recall";
import patterns from "../src/modules/patterns";
import scanner from "../src/modules/scanner";
import graphExport from "../src/modules/export";
import diff from "../src/modules/diff";
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
  await loadModules([recall(), patterns(), graphExport(), scanner(), diff()]);
});

describe("diff module", () => {
  test("registers graph_snapshot, graph_diff, graph_snapshots tools", async () => {
    const res = await rpc("tools/list");
    const names = (res.result as any).tools.map((t: any) => t.name);
    expect(names).toContain("graph_snapshot");
    expect(names).toContain("graph_diff");
    expect(names).toContain("graph_snapshots");
  });

  test("snapshot captures current state", async () => {
    await callTool("scanner_scan", { dir: FIXTURE_DIR });
    const snap = await callTool("graph_snapshot", {});
    expect(snap.ok).toBe(true);
    expect(snap.nodes).toBeGreaterThan(0);
    expect(snap.edges).toBeGreaterThan(0);
    expect(snap.timestamp).toBeGreaterThan(0);
  });

  test("diff with no previous snapshot shows all as added", async () => {
    await callTool("scanner_scan", { dir: FIXTURE_DIR });
    const result = await callTool("graph_diff", {});
    expect(result.summary.nodesAdded).toBeGreaterThan(0);
    expect(result.summary.nodesRemoved).toBe(0);
    expect(result.summary.nodesChanged).toBe(0);
  });

  test("diff after snapshot with no changes shows empty diff", async () => {
    await callTool("scanner_scan", { dir: FIXTURE_DIR });
    await callTool("graph_snapshot", {});
    const result = await callTool("graph_diff", {});
    expect(result.summary.nodesAdded).toBe(0);
    expect(result.summary.nodesRemoved).toBe(0);
    expect(result.summary.nodesChanged).toBe(0);
    expect(result.summary.edgesAdded).toBe(0);
    expect(result.summary.edgesRemoved).toBe(0);
  });

  test("diff detects added nodes", async () => {
    // Snapshot empty state
    await callTool("graph_snapshot", {});
    // Scan adds nodes
    await callTool("scanner_scan", { dir: FIXTURE_DIR });
    const result = await callTool("graph_diff", {});
    expect(result.summary.nodesAdded).toBeGreaterThan(0);
    expect(result.nodes.added.length).toBeGreaterThan(0);
  });

  test("diff detects changed nodes", async () => {
    await callTool("scanner_scan", { dir: FIXTURE_DIR });
    await callTool("graph_snapshot", {});
    // Manually change a node's metadata
    await callTool("patterns_add_node", {
      id: "server.ts", type: "file", name: "server.ts",
      metadata: { functions: 999 }, // changed count
    });
    const result = await callTool("graph_diff", {});
    expect(result.summary.nodesChanged).toBeGreaterThanOrEqual(1);
    expect(result.nodes.changed).toContain("server.ts");
  });

  test("named snapshots", async () => {
    await callTool("scanner_scan", { dir: FIXTURE_DIR });
    await callTool("graph_snapshot", { name: "v1" });
    const list = await callTool("graph_snapshots", {});
    expect(list.snapshots).toContain("v1");
  });

  test("diff against named snapshot", async () => {
    // Take snapshot of empty state as "before"
    await callTool("graph_snapshot", { name: "before" });
    await callTool("scanner_scan", { dir: FIXTURE_DIR });
    const result = await callTool("graph_diff", { name: "before" });
    expect(result.summary.nodesAdded).toBeGreaterThan(0);
  });

  test("exposes diff API on context", async () => {
    _reset();
    let apiRef: any;
    await loadModules([
      recall(), patterns(), graphExport(), diff(),
      {
        name: "consumer",
        depends: ["diff"],
        init(ctx) { apiRef = ctx.diff; },
      },
    ]);
    expect(apiRef).toBeDefined();
    expect(typeof apiRef.snapshot).toBe("function");
    expect(typeof apiRef.compare).toBe("function");
    expect(typeof apiRef.listSnapshots).toBe("function");
  });
});
