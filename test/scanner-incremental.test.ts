import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { handleRequest, _reset, loadModules } from "../src/mcp";
import type { PatternsAPI } from "../src/modules/patterns";
import recall from "../src/modules/recall";
import patterns from "../src/modules/patterns";
import scanner from "../src/modules/scanner";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const rpc = (method: string, params?: unknown) =>
  handleRequest({ jsonrpc: "2.0", id: 1, method, params });

const callTool = async (name: string, args: Record<string, unknown>) => {
  const res = await rpc("tools/call", { name, arguments: args });
  return JSON.parse((res.result as any).content[0].text);
};

let dir: string;
let papi: PatternsAPI;

beforeEach(async () => {
  _reset();
  await loadModules([
    recall(), patterns(), scanner(),
    { name: "probe", depends: ["patterns"], init(ctx) { papi = ctx.patterns as PatternsAPI; } },
  ]);
  dir = await mkdtemp(join(tmpdir(), "tms-scan-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const write = (rel: string, content: string) => Bun.write(join(dir, rel), content);

describe("scanner incremental cleanup", () => {
  test("removes a function's node and edges when it disappears from a file", async () => {
    await write("a.ts", `export function foo() {}\nexport function bar() {}\n`);
    await callTool("scanner_scan", { dir });

    expect(papi.getNode("a.ts:foo")).not.toBeNull();
    expect(papi.getNode("a.ts:bar")).not.toBeNull();

    // Rewrite without bar
    await write("a.ts", `export function foo() { return 1; }\n`);
    const r = await callTool("scanner_scan", { dir });
    expect(r.parsed).toBe(1);

    expect(papi.getNode("a.ts:foo")).not.toBeNull();
    expect(papi.getNode("a.ts:bar")).toBeNull();
    // The file→bar defines/exports edges are gone too
    const edges = papi.getEdges("a.ts").map(e => e.to);
    expect(edges).not.toContain("a.ts:bar");
  });

  test("drops a whole file slice when the file is deleted", async () => {
    await write("a.ts", `import { thing } from "./b";\nexport function use() { return thing(); }\n`);
    await write("b.ts", `export function thing() { return 1; }\n`);
    await callTool("scanner_scan", { dir });
    expect(papi.getNode("b.ts")).not.toBeNull();
    expect(papi.getNode("b.ts:thing")).not.toBeNull();

    await rm(join(dir, "b.ts"));
    const r = await callTool("scanner_scan", { dir });
    expect(r.removed).toBeGreaterThanOrEqual(1);
    expect(papi.getNode("b.ts")).toBeNull();
    expect(papi.getNode("b.ts:thing")).toBeNull();
  });

  test("preserves user-set boost across a rescan of a changed file", async () => {
    await write("a.ts", `export function foo() {}\n`);
    await callTool("scanner_scan", { dir });
    papi.setBoost("a.ts:foo", 7);
    expect(papi.getNode("a.ts:foo")?.boost).toBe(7);

    await write("a.ts", `export function foo() { return 42; }\n`);
    await callTool("scanner_scan", { dir });
    // foo survives the rescan, so its boost must survive too
    expect(papi.getNode("a.ts:foo")?.boost).toBe(7);
  });
});

describe("scanner import resolution", () => {
  test("resolves an extensionless import to the existing file and skips missing ones", async () => {
    await write("a.ts", `import { thing } from "./b";\nimport { gone } from "./missing";\nexport function use() { return thing(); }\n`);
    await write("b.ts", `export function thing() { return 1; }\n`);
    await callTool("scanner_scan", { dir });

    const imports = papi.getEdges("a.ts").filter(e => e.from === "a.ts" && e.relationship === "imports").map(e => e.to);
    expect(imports).toContain("b.ts");
    expect(imports.some(t => t.includes("missing"))).toBe(false);
  });

  test("resolves a directory import to its index file", async () => {
    await write("a.ts", `import { v } from "./lib";\nexport function use() { return v; }\n`);
    await write("lib/index.ts", `export const v = 1;\n`);
    await callTool("scanner_scan", { dir });

    const imports = papi.getEdges("a.ts").filter(e => e.relationship === "imports").map(e => e.to);
    expect(imports).toContain("lib/index.ts");
  });
});
