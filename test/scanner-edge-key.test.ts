import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { loadModules, closeModules, _reset } from "../src/mcp";
import type { ModuleContext, ModuleMetadata } from "../src/mcp";
import recall from "../src/modules/recall";
import patterns from "../src/modules/patterns";
import scanner from "../src/modules/scanner";
import type { RecallAPI } from "../src/modules/recall";
import type { ScannerAPI } from "../src/modules/scanner";
import { join } from "path";

const FIXTURE = join(import.meta.dir, "fixtures", "scanner-project");

let ctx!: ModuleContext;
const probe: ModuleMetadata = { name: "probe", depends: ["recall", "patterns", "scanner"], init(c) { ctx = c; } };

beforeEach(async () => { _reset(); await loadModules([recall(), patterns(), scanner(), probe]); });
afterEach(async () => { await closeModules(); _reset(); });

describe("scanner cache edge-key format", () => {
  test("edge keys are separated by NUL, so the cache format is unchanged", async () => {
    await (ctx.scanner as ScannerAPI).scan(FIXTURE);

    const cache = (ctx.recall as RecallAPI).internal("scanner");
    const slices = cache.query("slice:%") as [string, { nodes: string[]; edges: string[] }][];
    expect(slices.length).toBeGreaterThan(0);

    const keys = slices.flatMap(([, slice]) => slice.edges);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).toInclude("\0");
      // from, to, relationship — exactly three fields, none of them empty.
      const parts = key.split("\0");
      expect(parts.length).toBe(3);
      expect(parts.every(part => part.length > 0)).toBe(true);
    }
  });

  test("a rescan round-trips cached keys and removes nothing spuriously", async () => {
    const first = await (ctx.scanner as ScannerAPI).scan(FIXTURE);
    expect(first.parsed).toBeGreaterThan(0);

    // Unchanged files are skipped, but the deleted-file sweep still parses every
    // cached edge key. A separator mismatch would drop live edges here.
    const before = (ctx.recall as RecallAPI).db().prepare(`SELECT count(*) c FROM patterns_edges`).get() as { c: number };
    const second = await (ctx.scanner as ScannerAPI).scan(FIXTURE);
    const after = (ctx.recall as RecallAPI).db().prepare(`SELECT count(*) c FROM patterns_edges`).get() as { c: number };

    expect(second.removed).toBe(0);
    expect(after.c).toBe(before.c);
  });

  test("the source file contains no raw control bytes", async () => {
    const bytes = await Bun.file(new URL("../src/modules/scanner.ts", import.meta.url)).bytes();
    // Tab (0x09), newline (0x0A) and carriage return (0x0D) are the only ones a
    // source file should carry. A raw NUL made grep and git treat this as binary.
    const offenders = [...bytes].filter(b => b < 0x09 || (b > 0x0d && b < 0x20));
    expect(offenders).toEqual([]);
  });
});
