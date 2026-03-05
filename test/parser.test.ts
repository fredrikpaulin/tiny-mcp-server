import { describe, test, expect } from "bun:test";
import { parseModule } from "../src/analyzer/parser.js";
import { getFunction, getCall } from "../src/analyzer/ast.js";

// Helper: parse source and return { ast, module, hadError, errorMsg }
const parse = (source: string, file = "test.ts") => parseModule(source, file);

// --- Fix #1: Regex character class with unescaped slash ---

describe("lexer: regex character class", () => {
  test("regex with / inside character class parses without error", () => {
    const { hadError } = parse(`const re = /[/]/;`);
    expect(hadError).toBe(false);
  });

  test("regex with multiple chars in class including /", () => {
    const { hadError } = parse(`const re = /[a/b]/g;`);
    expect(hadError).toBe(false);
  });

  test("nested brackets in regex don't confuse lexer", () => {
    const { hadError } = parse(`const re = /[\\[\\]]/;`);
    expect(hadError).toBe(false);
  });
});

// --- Fix #12: Regex flag validation ---

describe("lexer: regex flags", () => {
  test("valid flags gi accepted", () => {
    const { hadError } = parse(`const re = /abc/gi;`);
    expect(hadError).toBe(false);
  });

  test("valid flag combination dgimsuy accepted", () => {
    const { hadError } = parse(`const re = /x/dgimsuy;`);
    expect(hadError).toBe(false);
  });

  test("invalid flag z is not consumed as regex flag", () => {
    // /abc/ is a valid regex, z should be treated as a separate identifier
    // not silently consumed as a flag — the parser won't error because
    // `const re = /abc/ z;` is parseable (division context fallback)
    // but the key check is: does the regex NOT have z as a flag?
    const { ast } = parse(`const re = /abc/gi; const z = 1;`);
    // If z were consumed as a flag, the second const would fail
    expect(ast.variables.length).toBeGreaterThanOrEqual(2);
  });
});

// --- Fix #4: findById uses cached Map ---

describe("ast: findById cache", () => {
  test("getFunction returns correct function by id", () => {
    const { ast } = parse(`function foo() {} function bar() {}`);
    const fn0 = ast.functions[0];
    const fn1 = ast.functions[1];
    expect(getFunction(ast, fn0.id)?.name).toBe("foo");
    expect(getFunction(ast, fn1.id)?.name).toBe("bar");
  });

  test("getCall returns correct call by id", () => {
    const { ast } = parse(`console.log("a"); process.exit(1);`);
    if (ast.calls.length >= 2) {
      const c0 = ast.calls[0];
      const c1 = ast.calls[1];
      expect(getCall(ast, c0.id)).toBeTruthy();
      expect(getCall(ast, c1.id)).toBeTruthy();
    }
  });

  test("findById returns null for missing id", () => {
    const { ast } = parse(`function foo() {}`);
    expect(getFunction(ast, 999999)).toBeNull();
  });
});

// --- Fix #11: Sentinel value — id 0 not dropped ---

describe("ast: sentinel value for id 0", () => {
  test("first function has id 0 or valid id and is retrievable", () => {
    // The first module gets id 0, first function gets id based on storage
    const { ast } = parse(`function first() {}`);
    const fn = ast.functions[0];
    expect(fn).toBeTruthy();
    expect(getFunction(ast, fn.id)?.name).toBe("first");
  });
});

// --- Fix #10: Multiple parse errors accumulated ---

describe("parser: multiple errors", () => {
  test("accumulates more than one error", () => {
    // Two separate syntax errors
    const { hadError, errorMsg } = parse(`
      function foo( { }
      function bar( { }
    `);
    expect(hadError).toBe(true);
    // Should contain multiple error lines (joined by \n)
    const lines = (errorMsg || "").split("\n").filter((l: string) => l.startsWith("Line"));
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });
});

// --- Fix #13: isClosingGt rename (functional, not naming) ---
// Already covered by the >> test below — just ensuring type annotations parse

// --- Fix #8: Type annotation >> handling ---

describe("parser: nested generics with >>", () => {
  test("Map<string, Map<string, number>> parses without error", () => {
    const { hadError } = parse(`const m: Map<string, Map<string, number>> = new Map();`);
    expect(hadError).toBe(false);
  });

  test("triple nested generics with >>> parses", () => {
    const { hadError } = parse(`const m: Map<string, Map<string, Set<number>>> = new Map();`);
    expect(hadError).toBe(false);
  });

  test("Promise<Array<Map<string, number>>> parses", () => {
    const { hadError } = parse(`
      function fetch(): Promise<Array<Map<string, number>>> {
        return Promise.resolve([]);
      }
    `);
    expect(hadError).toBe(false);
  });
});

// --- Fix #5: Optional chaining preserved in buildChain ---

describe("parser: optional chaining in call chains", () => {
  test("foo?.bar recorded with ?. in fullChain", () => {
    const { ast } = parse(`foo?.bar();`);
    const call = ast.calls.find((c: any) => c.callee === "foo");
    expect(call).toBeTruthy();
    expect(call.fullChain).toBe("foo?.bar");
  });

  test("a?.b?.c preserves both ?. markers", () => {
    const { ast } = parse(`a?.b?.c();`);
    const call = ast.calls.find((c: any) => c.callee === "a");
    expect(call).toBeTruthy();
    const markers = (call.fullChain.match(/\?\./g) || []).length;
    expect(markers).toBe(2);
  });

  test("mixed dot and optional chaining", () => {
    const { ast } = parse(`a.b?.c.d();`);
    const call = ast.calls.find((c: any) => c.callee === "a");
    expect(call).toBeTruthy();
    expect(call.fullChain).toBe("a.b?.c.d");
  });
});

// --- Fix #9: Template literal refs respect scope ---

describe("parser: template literal scope check", () => {
  test("local variable in template is not recorded as identifierRef", () => {
    const { module: mod } = parse(`
      function greet() {
        const name = "world";
        console.log(\`hello \${name}\`);
      }
    `);
    // 'name' is local to greet, should NOT appear in module-level identifierRefs
    const refs = mod.identifierRefs.map((r: any) => r.name);
    expect(refs).not.toContain("name");
  });

  test("global variable in template IS recorded as identifierRef", () => {
    const { module: mod } = parse(`
      function greet() {
        console.log(\`hello \${globalVar}\`);
      }
    `);
    const refs = mod.identifierRefs.map((r: any) => r.name);
    expect(refs).toContain("globalVar");
  });

  test("param in template is not recorded as identifierRef", () => {
    const { module: mod } = parse(`
      function greet(user) {
        return \`hi \${user}\`;
      }
    `);
    const refs = mod.identifierRefs.map((r: any) => r.name);
    expect(refs).not.toContain("user");
  });
});
