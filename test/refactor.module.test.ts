import { describe, test, expect, beforeEach } from "bun:test";
import { handleRequest, _reset, loadModules } from "../src/mcp";
import recall from "../src/modules/recall";
import patterns from "../src/modules/patterns";
import scanner from "../src/modules/scanner";
import refactor from "../src/modules/refactor";
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
  await loadModules([recall(), patterns(), scanner(), refactor()]);
  await callTool("scanner_scan", { dir: FIXTURE_DIR });
});

describe("refactor module", () => {
  test("registers refactor_refs and refactor_rename_impact tools", async () => {
    const res = await rpc("tools/list");
    const names = (res.result as any).tools.map((t: any) => t.name);
    expect(names).toContain("refactor_refs");
    expect(names).toContain("refactor_rename_impact");
  });

  test("finds references by exact node ID", async () => {
    const result = await callTool("refactor_refs", { symbol: "server.ts:handleRequest" });
    expect(result.definition).not.toBeNull();
    expect(result.definition.relationship).toBe("defines");
    expect(result.symbol).toBe("server.ts:handleRequest");
  });

  test("finds references by name only", async () => {
    const result = await callTool("refactor_refs", { symbol: "validate" });
    expect(result.definition).not.toBeNull();
    expect(result.count).toBeGreaterThan(0);
  });

  test("returns null definition for unknown symbol", async () => {
    const result = await callTool("refactor_refs", { symbol: "nonExistentSymbol" });
    expect(result.definition).toBeNull();
    expect(result.count).toBe(0);
  });

  test("finds call references", async () => {
    // handleRequest calls validate in our fixture
    const result = await callTool("refactor_refs", { symbol: "validate" });
    const callRefs = result.references.filter((r: any) => r.relationship === "calls");
    expect(callRefs.length).toBeGreaterThanOrEqual(1);
  });

  test("finds import references via specifiers", async () => {
    const result = await callTool("refactor_refs", { symbol: "validate" });
    const importRefs = result.references.filter((r: any) => r.relationship === "imports");
    expect(importRefs.length).toBeGreaterThanOrEqual(1);
  });

  test("rename impact includes definition and references", async () => {
    const result = await callTool("refactor_rename_impact", {
      symbol: "validate",
      newName: "validateInput",
    });
    expect(result.newName).toBe("validateInput");
    expect(result.count).toBeGreaterThan(0);
    const rels = result.affected.map((a: any) => a.relationship);
    expect(rels).toContain("definition");
  });

  test("rename impact for unknown symbol returns empty", async () => {
    const result = await callTool("refactor_rename_impact", {
      symbol: "doesNotExist",
      newName: "anything",
    });
    expect(result.count).toBe(0);
    expect(result.affected).toEqual([]);
  });

  test("exposes refactor API on context", async () => {
    _reset();
    let apiRef: any;
    await loadModules([
      recall(), patterns(), refactor(),
      {
        name: "consumer",
        depends: ["refactor"],
        init(ctx) { apiRef = ctx.refactor; },
      },
    ]);
    expect(apiRef).toBeDefined();
    expect(typeof apiRef.findRefs).toBe("function");
    expect(typeof apiRef.renameImpact).toBe("function");
  });
});
