import { describe, test, expect, beforeEach } from "bun:test";
import { handleRequest, _reset, loadModules } from "../src/mcp";
import recall from "../src/modules/recall";
import patterns from "../src/modules/patterns";
import scanner from "../src/modules/scanner";
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
  await loadModules([recall(), patterns(), scanner()]);
});

describe("scanner module", () => {
  test("registers scanner_scan tool", async () => {
    const res = await rpc("tools/list");
    const names = (res.result as any).tools.map((t: any) => t.name);
    expect(names).toContain("scanner_scan");
  });

  test("scans fixture directory", async () => {
    const result = await callTool("scanner_scan", { dir: FIXTURE_DIR });
    expect(result.files).toBe(5);
    expect(result.parsed).toBe(5);
    expect(result.errors.length).toBe(0);
    expect(result.nodes).toBeGreaterThan(0);
    expect(result.edges).toBeGreaterThan(0);
    expect(result.timing_ms).toBeGreaterThan(0);
  });

  test("creates file nodes", async () => {
    await callTool("scanner_scan", { dir: FIXTURE_DIR });
    const files = await callTool("patterns_query", { type: "file" });
    const names = files.results.map((f: any) => f.name);
    expect(names).toContain("server.ts");
    expect(names).toContain("index.ts");
    expect(names).toContain("utils/validate.ts");
    expect(names).toContain("utils/db.ts");
    expect(names).toContain("utils/types.ts");
  });

  test("creates function nodes", async () => {
    await callTool("scanner_scan", { dir: FIXTURE_DIR });
    const fns = await callTool("patterns_query", { type: "function" });
    const names = fns.results.map((f: any) => f.name);
    expect(names).toContain("handleRequest");
    expect(names).toContain("validate");
    expect(names).toContain("sanitize");
    expect(names).toContain("internalHelper");
  });

  test("creates class nodes", async () => {
    await callTool("scanner_scan", { dir: FIXTURE_DIR });
    const classes = await callTool("patterns_query", { type: "class" });
    const names = classes.results.map((c: any) => c.name);
    expect(names).toContain("AppServer");
    expect(names).toContain("Database");
  });

  test("creates import edges between files", async () => {
    await callTool("scanner_scan", { dir: FIXTURE_DIR });
    const imports = await callTool("patterns_query", { relationship: "imports" });
    expect(imports.count).toBeGreaterThanOrEqual(3);

    // server.ts imports from utils/validate.ts and utils/db.ts
    const serverImports = await callTool("patterns_neighbors", {
      id: "server.ts", direction: "outgoing", relationship: "imports",
    });
    const targets = serverImports.nodes.map((n: any) => n.id);
    expect(targets.some((t: string) => t.includes("validate"))).toBe(true);
    expect(targets.some((t: string) => t.includes("db"))).toBe(true);
  });

  test("creates defines edges from file to symbols", async () => {
    await callTool("scanner_scan", { dir: FIXTURE_DIR });
    const defines = await callTool("patterns_neighbors", {
      id: "server.ts", direction: "outgoing", relationship: "defines",
    });
    const names = defines.nodes.map((n: any) => n.name);
    expect(names).toContain("handleRequest");
    expect(names).toContain("AppServer");
    expect(names).toContain("internalHelper");
  });

  test("creates exports edges for exported symbols", async () => {
    await callTool("scanner_scan", { dir: FIXTURE_DIR });
    const exports = await callTool("patterns_neighbors", {
      id: "utils/validate.ts", direction: "outgoing", relationship: "exports",
    });
    const names = exports.nodes.map((n: any) => n.name);
    expect(names).toContain("validate");
    expect(names).toContain("sanitize");
  });

  test("creates variable nodes for exported variables", async () => {
    await callTool("scanner_scan", { dir: FIXTURE_DIR });
    const vars = await callTool("patterns_query", { type: "variable" });
    const names = vars.results.map((v: any) => v.name);
    expect(names).toContain("DB_VERSION");
  });

  test("incremental scan skips unchanged files", async () => {
    const r1 = await callTool("scanner_scan", { dir: FIXTURE_DIR });
    expect(r1.parsed).toBe(5);

    const r2 = await callTool("scanner_scan", { dir: FIXTURE_DIR });
    expect(r2.parsed).toBe(0);
    expect(r2.skipped).toBe(5);
  });

  test("force flag rescans all files", async () => {
    await callTool("scanner_scan", { dir: FIXTURE_DIR });
    const r2 = await callTool("scanner_scan", { dir: FIXTURE_DIR, force: true });
    expect(r2.parsed).toBe(5);
    expect(r2.skipped).toBe(0);
  });

  // --- New enriched extraction tests ---

  test("function nodes have complexity metadata", async () => {
    await callTool("scanner_scan", { dir: FIXTURE_DIR });
    const fns = await callTool("patterns_query", { type: "function" });
    const complex = fns.results.find((f: any) => f.name === "complexHandler");
    expect(complex).toBeTruthy();
    expect(complex.metadata?.complexity).toBeGreaterThan(1);
    expect(complex.metadata?.maxNesting).toBeGreaterThan(0);
    expect(complex.metadata?.loopCount).toBeGreaterThan(0);
  });

  test("async functions have async flag", async () => {
    await callTool("scanner_scan", { dir: FIXTURE_DIR });
    const fns = await callTool("patterns_query", { type: "function" });
    const fetchFn = fns.results.find((f: any) => f.name === "fetchData");
    expect(fetchFn).toBeTruthy();
    expect(fetchFn.metadata?.async).toBe(true);
  });

  test("creates interface nodes", async () => {
    await callTool("scanner_scan", { dir: FIXTURE_DIR });
    const ifaces = await callTool("patterns_query", { type: "interface" });
    const names = ifaces.results.map((i: any) => i.name);
    expect(names).toContain("Serializable");
    expect(names).toContain("Cacheable");
  });

  test("interface extends edge", async () => {
    await callTool("scanner_scan", { dir: FIXTURE_DIR });
    // Extends targets are symbolic names — check outgoing edges directly
    const edges = await callTool("patterns_query", { relationship: "extends" });
    const fromCacheable = edges.results.filter(
      (e: any) => e.from === "utils/types.ts:Cacheable"
    );
    expect(fromCacheable.length).toBeGreaterThanOrEqual(1);
    expect(fromCacheable.some((e: any) => e.to === "Serializable")).toBe(true);
  });

  test("creates type alias nodes", async () => {
    await callTool("scanner_scan", { dir: FIXTURE_DIR });
    const types = await callTool("patterns_query", { type: "type" });
    const names = types.results.map((t: any) => t.name);
    expect(names).toContain("HttpMethod");
    expect(names).toContain("RequestHandler");
  });

  test("class implements edge", async () => {
    await callTool("scanner_scan", { dir: FIXTURE_DIR });
    const edges = await callTool("patterns_query", { relationship: "implements" });
    const fromAppServer = edges.results.filter(
      (e: any) => e.from === "server.ts:AppServer"
    );
    expect(fromAppServer.length).toBeGreaterThanOrEqual(1);
    expect(fromAppServer.some((e: any) => e.to === "Cacheable")).toBe(true);
  });

  test("class has_method edges", async () => {
    await callTool("scanner_scan", { dir: FIXTURE_DIR });
    const methods = await callTool("patterns_neighbors", {
      id: "server.ts:AppServer", direction: "outgoing", relationship: "has_method",
    });
    const names = methods.nodes.map((n: any) => n.name);
    expect(names.some((n: string) => n.includes("start"))).toBe(true);
  });

  test("side effect edges from fetch calls", async () => {
    await callTool("scanner_scan", { dir: FIXTURE_DIR });
    const edges = await callTool("patterns_query", { relationship: "has_effect" });
    const fromFetch = edges.results.filter(
      (e: any) => e.from === "server.ts:fetchData"
    );
    expect(fromFetch.length).toBeGreaterThanOrEqual(1);
    expect(fromFetch.some((e: any) => e.to === "effect:network")).toBe(true);
  });

  test("cross-file call edges", async () => {
    await callTool("scanner_scan", { dir: FIXTURE_DIR });
    // handleRequest calls validate which is imported from utils/validate.ts
    const calls = await callTool("patterns_neighbors", {
      id: "server.ts:handleRequest", direction: "outgoing", relationship: "calls",
    });
    const targets = calls.nodes.map((n: any) => n.id);
    expect(targets.some((t: string) => t.includes("validate"))).toBe(true);
  });

  test("ScanResult includes interface and typeAlias counts", async () => {
    const result = await callTool("scanner_scan", { dir: FIXTURE_DIR });
    expect(result.interfaces).toBeGreaterThanOrEqual(2);
    expect(result.typeAliases).toBeGreaterThanOrEqual(2);
  });

  test("graph traversal works after scan", async () => {
    await callTool("scanner_scan", { dir: FIXTURE_DIR });

    // Traverse outgoing from index.ts
    const result = await callTool("patterns_traverse", {
      startId: "index.ts", direction: "outgoing", maxDepth: 3,
    });
    const ids = result.nodes.map((n: any) => n.id);
    expect(ids).toContain("index.ts");
    expect(ids).toContain("server.ts");
  });

  test("exposes scanner API on context", async () => {
    _reset();
    let apiRef: any;
    await loadModules([
      recall(), patterns(), scanner(),
      {
        name: "consumer",
        depends: ["scanner"],
        init(ctx) { apiRef = ctx.scanner; },
      },
    ]);
    expect(apiRef).toBeDefined();
    expect(typeof apiRef.scan).toBe("function");
  });

  test("emits scanner:complete event", async () => {
    _reset();
    let eventData: any;
    await loadModules([
      recall(), patterns(), scanner(),
      {
        name: "listener",
        depends: ["scanner"],
        init(ctx) { ctx.on("scanner:complete", (data) => { eventData = data; }); },
      },
    ]);
    await callTool("scanner_scan", { dir: FIXTURE_DIR });
    expect(eventData).toBeDefined();
    expect(eventData.files).toBe(5);
  });
});
