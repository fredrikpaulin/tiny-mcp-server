import { describe, test, expect, beforeEach } from "bun:test";
import { handleRequest, _reset, loadModules } from "../src/mcp";
import recall from "../src/modules/recall";
import patterns from "../src/modules/patterns";
import beacon from "../src/modules/beacon";
import scanner from "../src/modules/scanner";
import prompt from "../src/modules/prompt";
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
  await loadModules([recall(), patterns(), beacon(), scanner(), prompt()]);
  await callTool("scanner_scan", { dir: FIXTURE_DIR });
});

describe("prompt builder module", () => {
  test("registers prompt_build tool", async () => {
    const res = await rpc("tools/list");
    const names = (res.result as any).tools.map((t: any) => t.name);
    expect(names).toContain("prompt_build");
  });

  test("builds prompt for a function by name", async () => {
    const result = await callTool("prompt_build", {
      symbol: "handleRequest",
      baseDir: FIXTURE_DIR,
    });
    expect(result.focus).toBe("server.ts:handleRequest");
    expect(result.sections.length).toBeGreaterThan(0);
    expect(result.prompt).toContain("handleRequest");
    expect(result.tokenEstimate).toBeGreaterThan(0);
  });

  test("builds prompt for a function by full node ID", async () => {
    const result = await callTool("prompt_build", {
      symbol: "server.ts:handleRequest",
      baseDir: FIXTURE_DIR,
    });
    expect(result.focus).toBe("server.ts:handleRequest");
    const focus = result.sections.find((s: any) => s.relationship === "focus");
    expect(focus).toBeDefined();
    expect(focus.source).toContain("function handleRequest");
  });

  test("includes parent file imports", async () => {
    const result = await callTool("prompt_build", {
      symbol: "handleRequest",
      baseDir: FIXTURE_DIR,
    });
    const parent = result.sections.find((s: any) => s.relationship === "parent");
    expect(parent).toBeDefined();
    expect(parent.source).toContain("import");
  });

  test("includes dependency (validate called by handleRequest)", async () => {
    const result = await callTool("prompt_build", {
      symbol: "handleRequest",
      baseDir: FIXTURE_DIR,
    });
    const deps = result.sections.filter((s: any) => s.relationship === "dependency");
    const validateDep = deps.find((d: any) => d.name === "validate");
    expect(validateDep).toBeDefined();
    expect(validateDep.source).toContain("function validate");
  });

  test("includes callers", async () => {
    const result = await callTool("prompt_build", {
      symbol: "validate",
      baseDir: FIXTURE_DIR,
    });
    const callers = result.sections.filter((s: any) => s.relationship === "caller");
    expect(callers.length).toBeGreaterThanOrEqual(1);
    const hreqCaller = callers.find((c: any) => c.name === "handleRequest");
    expect(hreqCaller).toBeDefined();
  });

  test("includes types/interfaces from imported files", async () => {
    const result = await callTool("prompt_build", {
      symbol: "AppServer",
      baseDir: FIXTURE_DIR,
    });
    const types = result.sections.filter((s: any) => s.relationship === "type");
    // server.ts imports from utils/types.ts which defines Cacheable, Serializable, etc.
    expect(types.length).toBeGreaterThan(0);
  });

  test("respects maxTokens budget", async () => {
    const small = await callTool("prompt_build", {
      symbol: "handleRequest",
      baseDir: FIXTURE_DIR,
      maxTokens: 50,
    });
    const large = await callTool("prompt_build", {
      symbol: "handleRequest",
      baseDir: FIXTURE_DIR,
      maxTokens: 10000,
    });
    // Small budget should have fewer sections
    expect(small.sections.length).toBeLessThanOrEqual(large.sections.length);
  });

  test("callers can be disabled", async () => {
    const result = await callTool("prompt_build", {
      symbol: "validate",
      baseDir: FIXTURE_DIR,
      callers: false,
    });
    const callers = result.sections.filter((s: any) => s.relationship === "caller");
    expect(callers.length).toBe(0);
  });

  test("deps can be disabled", async () => {
    const result = await callTool("prompt_build", {
      symbol: "handleRequest",
      baseDir: FIXTURE_DIR,
      deps: false,
    });
    const deps = result.sections.filter((s: any) => s.relationship === "dependency");
    expect(deps.length).toBe(0);
  });

  test("types can be disabled", async () => {
    const result = await callTool("prompt_build", {
      symbol: "AppServer",
      baseDir: FIXTURE_DIR,
      types: false,
    });
    const types = result.sections.filter((s: any) => s.relationship === "type");
    expect(types.length).toBe(0);
  });

  test("unknown symbol returns empty prompt", async () => {
    const result = await callTool("prompt_build", {
      symbol: "doesNotExist",
      baseDir: FIXTURE_DIR,
    });
    expect(result.sections.length).toBe(0);
    expect(result.tokenEstimate).toBe(0);
    expect(result.prompt).toContain("not found");
  });

  test("prompt output is grouped by file", async () => {
    const result = await callTool("prompt_build", {
      symbol: "handleRequest",
      baseDir: FIXTURE_DIR,
    });
    // Should contain file markers
    expect(result.prompt).toContain("// ---");
    expect(result.prompt).toContain("server.ts");
  });

  test("prompt contains focus marker", async () => {
    const result = await callTool("prompt_build", {
      symbol: "handleRequest",
      baseDir: FIXTURE_DIR,
    });
    expect(result.prompt).toContain("FOCUS");
  });

  test("exposes prompt API on context", async () => {
    _reset();
    let apiRef: any;
    await loadModules([
      recall(), patterns(), prompt(),
      {
        name: "consumer",
        depends: ["prompt"],
        init(ctx) { apiRef = ctx.prompt; },
      },
    ]);
    expect(apiRef).toBeDefined();
    expect(typeof apiRef.build).toBe("function");
  });
});
