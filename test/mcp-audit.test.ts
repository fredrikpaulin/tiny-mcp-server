import { describe, test, expect, beforeEach } from "bun:test";
import { handleRequest, _reset, loadModules, registerResourceTemplate } from "../src/mcp";
import type { ModuleMetadata } from "../src/mcp";

const rpc = (method: string, params?: unknown) =>
  handleRequest({ jsonrpc: "2.0", id: 1, method, params });

beforeEach(() => { _reset(); });

describe("resource template literal escaping", () => {
  test("treats regex-special characters in the template as literals", async () => {
    // The "." must match a literal dot, not any character.
    registerResourceTemplate("items/{id}.json", "Item", "An item", "application/json", async ({ id }) => id ?? "");

    const ok = await rpc("resources/read", { uri: "items/42.json" });
    expect((ok.result as any).contents[0].text).toBe("42");

    // Missing the literal ".json" suffix must not match.
    const miss = await rpc("resources/read", { uri: "items/42Xjson" });
    expect((miss as any).error?.code).toBe(-32601);
  });

  test("matches parenthesised literals without treating them as groups", async () => {
    registerResourceTemplate("doc(v1)/{name}", "Doc", "A doc", "text/plain", async ({ name }) => name ?? "");
    const ok = await rpc("resources/read", { uri: "doc(v1)/readme" });
    expect((ok.result as any).contents[0].text).toBe("readme");
  });
});

describe("module load rollback", () => {
  test("closes already-initialized modules when a later module fails to init", async () => {
    const closed: string[] = [];
    const modA: ModuleMetadata = {
      name: "a",
      init() { /* ok */ },
      close() { closed.push("a"); },
    };
    const modB: ModuleMetadata = {
      name: "b",
      depends: ["a"],
      init() { throw new Error("boom"); },
    };

    let threw = false;
    try {
      await loadModules([modA, modB]);
    } catch (e) {
      threw = true;
      expect((e as Error).message).toContain("boom");
    }
    expect(threw).toBe(true);
    expect(closed).toEqual(["a"]);
  });
});
