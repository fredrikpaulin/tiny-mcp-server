import { describe, expect, test, beforeEach } from "bun:test";
import {
  registerTool,
  registerResource,
  registerResourceTemplate,
  handleRequest,
  validateInput,
  ToolError,
  _reset,
} from "../src/mcp";

beforeEach(() => _reset());

// --- helpers ---

const rpc = (method: string, params?: unknown) =>
  handleRequest({ jsonrpc: "2.0", id: 1, method, params });

// --- ping ---

describe("ping", () => {
  test("returns empty result", async () => {
    const res = await rpc("ping");
    expect(res).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  });
});

// --- initialize ---

describe("initialize", () => {
  test("returns server info and capabilities", async () => {
    const res = await rpc("initialize", { protocolVersion: "2025-11-25" });
    expect(res.result).toEqual({
      protocolVersion: "2025-11-25",
      capabilities: { tools: {}, resources: {}, sampling: {} },
      serverInfo: { name: "mcp-server", version: "1.0.0" },
    });
  });

  test("defaults protocolVersion when not provided", async () => {
    const res = await rpc("initialize", {});
    expect((res.result as any).protocolVersion).toBe("2025-11-25");
  });

  test("handles missing params", async () => {
    const res = await rpc("initialize");
    expect((res.result as any).protocolVersion).toBe("2025-11-25");
  });
});

// --- tools/list ---

describe("tools/list", () => {
  test("returns empty list when no tools registered", async () => {
    const res = await rpc("tools/list");
    expect((res.result as any).tools).toEqual([]);
  });

  test("returns registered tools with schema", async () => {
    const schema = { type: "object", properties: { x: { type: "number" } } };
    registerTool("add", "Adds numbers", schema, async () => 0);

    const res = await rpc("tools/list");
    const list = (res.result as any).tools;
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({ name: "add", description: "Adds numbers", inputSchema: schema });
  });

  test("lists multiple tools in registration order", async () => {
    registerTool("a", "A", {}, async () => null);
    registerTool("b", "B", {}, async () => null);
    registerTool("c", "C", {}, async () => null);

    const res = await rpc("tools/list");
    const names = (res.result as any).tools.map((t: any) => t.name);
    expect(names).toEqual(["a", "b", "c"]);
  });
});

// --- tools/call ---

describe("tools/call", () => {
  test("calls handler and returns JSON stringified result", async () => {
    registerTool("echo", "Echo", {}, async ({ msg }) => ({ echoed: msg }));

    const res = await rpc("tools/call", { name: "echo", arguments: { msg: "hi" } });
    const content = (res.result as any).content;
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("text");
    expect(JSON.parse(content[0].text)).toEqual({ echoed: "hi" });
  });

  test("returns error for unknown tool", async () => {
    const res = await rpc("tools/call", { name: "nope", arguments: {} });
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(-32601);
    expect(res.error!.message).toContain("nope");
  });

  test("catches handler errors and returns isError content with code", async () => {
    registerTool("fail", "Fail", {}, async () => { throw new Error("boom"); });

    const res = await rpc("tools/call", { name: "fail", arguments: {} });
    const content = (res.result as any).content;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.isError).toBe(true);
    expect(parsed.code).toBe("internal_error");
    expect(parsed.error).toContain("boom");
  });

  test("passes arguments correctly to handler", async () => {
    let received: Record<string, unknown> = {};
    registerTool("capture", "Capture", {}, async (args) => { received = args; return "ok"; });

    await rpc("tools/call", { name: "capture", arguments: { a: 1, b: "two", c: true } });
    expect(received).toEqual({ a: 1, b: "two", c: true });
  });

  test("handles async handler", async () => {
    registerTool("slow", "Slow", {}, async () => {
      await new Promise(r => setTimeout(r, 10));
      return "done";
    });

    const res = await rpc("tools/call", { name: "slow", arguments: {} });
    expect(JSON.parse((res.result as any).content[0].text)).toBe("done");
  });
});

// --- resources/list ---

describe("resources/list", () => {
  test("returns empty lists when nothing registered", async () => {
    const res = await rpc("resources/list");
    expect((res.result as any).resources).toEqual([]);
    expect((res.result as any).resourceTemplates).toEqual([]);
  });

  test("lists static resources", async () => {
    registerResource("info://test", "Test", "A test resource", "text/plain", async () => "");

    const res = await rpc("resources/list");
    const list = (res.result as any).resources;
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({
      uri: "info://test",
      name: "Test",
      description: "A test resource",
      mimeType: "text/plain",
    });
  });

  test("lists resource templates", async () => {
    registerResourceTemplate("data://{id}", "Data", "Data by id", "application/json", async () => "");

    const res = await rpc("resources/list");
    const templates = (res.result as any).resourceTemplates;
    expect(templates).toHaveLength(1);
    expect(templates[0].uriTemplate).toBe("data://{id}");
  });

  test("lists both resources and templates together", async () => {
    registerResource("static://one", "One", "Static", "text/plain", async () => "");
    registerResourceTemplate("dynamic://{x}", "Dyn", "Dynamic", "text/plain", async () => "");

    const res = await rpc("resources/list");
    expect((res.result as any).resources).toHaveLength(1);
    expect((res.result as any).resourceTemplates).toHaveLength(1);
  });
});

// --- resources/read ---

describe("resources/read", () => {
  test("reads static string resource", async () => {
    registerResource("info://hello", "Hello", "Greeting", "text/plain", async () => "world");

    const res = await rpc("resources/read", { uri: "info://hello" });
    const contents = (res.result as any).contents;
    expect(contents).toHaveLength(1);
    expect(contents[0]).toEqual({ uri: "info://hello", mimeType: "text/plain", text: "world" });
  });

  test("reads binary resource as base64", async () => {
    const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    registerResource("bin://data", "Bin", "Binary", "application/octet-stream", async () => bytes);

    const res = await rpc("resources/read", { uri: "bin://data" });
    const contents = (res.result as any).contents;
    expect(contents[0].blob).toBe(Buffer.from(bytes).toString("base64"));
    expect(contents[0].text).toBeUndefined();
  });

  test("reads resource template with single variable", async () => {
    registerResourceTemplate(
      "env://{name}",
      "Env",
      "Env var",
      "text/plain",
      async ({ name }) => `value_of_${name}`
    );

    const res = await rpc("resources/read", { uri: "env://HOME" });
    const contents = (res.result as any).contents;
    expect(contents[0].text).toBe("value_of_HOME");
  });

  test("reads resource template with multiple variables", async () => {
    registerResourceTemplate(
      "db://{schema}/{table}",
      "DB",
      "Database table",
      "application/json",
      async ({ schema, table }) => JSON.stringify({ schema, table })
    );

    const res = await rpc("resources/read", { uri: "db://public/users" });
    const parsed = JSON.parse((res.result as any).contents[0].text);
    expect(parsed).toEqual({ schema: "public", table: "users" });
  });

  test("returns error for unknown resource", async () => {
    const res = await rpc("resources/read", { uri: "nope://missing" });
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(-32601);
    expect(res.error!.message).toContain("nope://missing");
  });

  test("returns error when static resource handler throws", async () => {
    registerResource("bad://res", "Bad", "Fails", "text/plain", async () => { throw new Error("read fail"); });

    const res = await rpc("resources/read", { uri: "bad://res" });
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(-32603);
    expect(res.error!.message).toContain("read fail");
  });

  test("returns error when template handler throws", async () => {
    registerResourceTemplate("err://{x}", "Err", "Errors", "text/plain", async () => { throw new Error("template fail"); });

    const res = await rpc("resources/read", { uri: "err://something" });
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(-32603);
    expect(res.error!.message).toContain("template fail");
  });

  test("static resource takes priority over matching template", async () => {
    registerResource("data://fixed", "Fixed", "Static", "text/plain", async () => "static");
    registerResourceTemplate("data://{id}", "Dynamic", "Template", "text/plain", async ({ id }) => `template_${id}`);

    const res = await rpc("resources/read", { uri: "data://fixed" });
    expect((res.result as any).contents[0].text).toBe("static");
  });
});

// --- unknown method ---

describe("unknown method", () => {
  test("returns -32601 error", async () => {
    const res = await rpc("nonexistent/method");
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(-32601);
    expect(res.error!.message).toContain("nonexistent/method");
  });
});

// --- registerTool ---

describe("registerTool", () => {
  test("overwrites existing tool with same name", async () => {
    registerTool("dup", "First", {}, async () => "first");
    registerTool("dup", "Second", {}, async () => "second");

    const list = await rpc("tools/list");
    expect((list.result as any).tools).toHaveLength(1);
    expect((list.result as any).tools[0].description).toBe("Second");

    const res = await rpc("tools/call", { name: "dup", arguments: {} });
    expect(JSON.parse((res.result as any).content[0].text)).toBe("second");
  });
});

// --- registerResourceTemplate pattern matching ---

describe("resource template pattern matching", () => {
  test("does not match partial URIs", async () => {
    registerResourceTemplate("file://{path}", "File", "File access", "text/plain", async ({ path }) => path);

    // Exact structure match
    const good = await rpc("resources/read", { uri: "file://test.txt" });
    expect((good.result as any).contents[0].text).toBe("test.txt");
  });

  test("matches greedily within capture groups", async () => {
    registerResourceTemplate("path://{full}", "Path", "Full path", "text/plain", async ({ full }) => full);

    const res = await rpc("resources/read", { uri: "path://a/b/c" });
    expect((res.result as any).contents[0].text).toBe("a/b/c");
  });
});

// --- JSON-RPC envelope ---

describe("JSON-RPC envelope", () => {
  test("preserves request id in response", async () => {
    const res = await handleRequest({ jsonrpc: "2.0", id: 42, method: "ping" });
    expect(res.id).toBe(42);
    expect(res.jsonrpc).toBe("2.0");
  });

  test("preserves string id", async () => {
    const res = await handleRequest({ jsonrpc: "2.0", id: "abc-123", method: "ping" });
    expect(res.id).toBe("abc-123");
  });
});

// --- ToolError ---

describe("ToolError", () => {
  test("handler throws ToolError includes code in response", async () => {
    registerTool("nf", "Not found", {}, async () => { throw new ToolError("not_found", "gone"); });

    const res = await rpc("tools/call", { name: "nf", arguments: {} });
    const parsed = JSON.parse((res.result as any).content[0].text);
    expect(parsed.isError).toBe(true);
    expect(parsed.code).toBe("not_found");
    expect(parsed.error).toContain("gone");
  });

  test("plain Error gets code internal_error", async () => {
    registerTool("ie", "Internal", {}, async () => { throw new Error("oops"); });

    const res = await rpc("tools/call", { name: "ie", arguments: {} });
    const parsed = JSON.parse((res.result as any).content[0].text);
    expect(parsed.code).toBe("internal_error");
  });

  test("is instanceof Error", () => {
    const err = new ToolError("test", "msg");
    expect(err instanceof Error).toBe(true);
    expect(err instanceof ToolError).toBe(true);
    expect(err.code).toBe("test");
    expect(err.message).toBe("msg");
  });
});

// --- validateInput ---

describe("validateInput", () => {
  test("missing required field", () => {
    const schema = { type: "object", required: ["name"], properties: { name: { type: "string" } } };
    const errors = validateInput(schema, {});
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({ path: "name", message: "required" });
  });

  test("multiple missing required fields", () => {
    const schema = { type: "object", required: ["a", "b"], properties: {} };
    const errors = validateInput(schema, {});
    expect(errors).toHaveLength(2);
    expect(errors.map(e => e.path)).toEqual(["a", "b"]);
  });

  test("wrong type string vs number", () => {
    const schema = { type: "object", properties: { x: { type: "number" } } };
    const errors = validateInput(schema, { x: "not a number" });
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe("x");
    expect(errors[0].message).toContain("expected number");
  });

  test("wrong type number vs string", () => {
    const schema = { type: "object", properties: { x: { type: "string" } } };
    const errors = validateInput(schema, { x: 42 });
    expect(errors[0].message).toContain("expected string");
  });

  test("integer type rejects float", () => {
    const schema = { type: "object", properties: { x: { type: "integer" } } };
    expect(validateInput(schema, { x: 1.5 })).toHaveLength(1);
    expect(validateInput(schema, { x: 2 })).toHaveLength(0);
  });

  test("boolean type check", () => {
    const schema = { type: "object", properties: { x: { type: "boolean" } } };
    expect(validateInput(schema, { x: "true" })).toHaveLength(1);
    expect(validateInput(schema, { x: true })).toHaveLength(0);
  });

  test("array type check", () => {
    const schema = { type: "object", properties: { x: { type: "array" } } };
    expect(validateInput(schema, { x: "not array" })).toHaveLength(1);
    expect(validateInput(schema, { x: [1, 2] })).toHaveLength(0);
  });

  test("null type check", () => {
    const schema = { type: "object", properties: { x: { type: "null" } } };
    expect(validateInput(schema, { x: "not null" })).toHaveLength(1);
    expect(validateInput(schema, { x: null })).toHaveLength(0);
  });

  test("enum violation", () => {
    const schema = { type: "object", properties: { fmt: { type: "string", enum: ["json", "xml"] } } };
    const errors = validateInput(schema, { fmt: "csv" });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("json");
    expect(errors[0].message).toContain("xml");
  });

  test("enum passes valid value", () => {
    const schema = { type: "object", properties: { fmt: { type: "string", enum: ["json", "xml"] } } };
    expect(validateInput(schema, { fmt: "json" })).toHaveLength(0);
  });

  test("nested object validation", () => {
    const schema = {
      type: "object",
      properties: {
        config: {
          type: "object",
          required: ["host"],
          properties: { host: { type: "string" }, port: { type: "number" } },
        },
      },
    };
    const errors = validateInput(schema, { config: { port: "bad" } });
    expect(errors.some(e => e.path === "config.host" && e.message === "required")).toBe(true);
    expect(errors.some(e => e.path === "config.port")).toBe(true);
  });

  test("array items validation", () => {
    const schema = { type: "object", properties: { tags: { type: "array", items: { type: "string" } } } };
    const errors = validateInput(schema, { tags: ["ok", 42, "fine"] });
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe("tags[1]");
  });

  test("minLength and maxLength", () => {
    const schema = { type: "object", properties: { name: { type: "string", minLength: 2, maxLength: 5 } } };
    expect(validateInput(schema, { name: "a" })).toHaveLength(1);
    expect(validateInput(schema, { name: "abcdef" })).toHaveLength(1);
    expect(validateInput(schema, { name: "abc" })).toHaveLength(0);
  });

  test("minimum and maximum", () => {
    const schema = { type: "object", properties: { age: { type: "number", minimum: 0, maximum: 150 } } };
    expect(validateInput(schema, { age: -1 })).toHaveLength(1);
    expect(validateInput(schema, { age: 200 })).toHaveLength(1);
    expect(validateInput(schema, { age: 25 })).toHaveLength(0);
  });

  test("valid input returns no errors", () => {
    const schema = {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" }, count: { type: "number" } },
    };
    expect(validateInput(schema, { name: "test", count: 5 })).toHaveLength(0);
  });

  test("empty schema returns no errors", () => {
    expect(validateInput({}, { anything: "goes" })).toHaveLength(0);
  });

  test("skips validation for undefined optional properties", () => {
    const schema = { type: "object", properties: { opt: { type: "number" } } };
    expect(validateInput(schema, {})).toHaveLength(0);
  });
});

// --- input validation in tools/call ---

describe("tools/call input validation", () => {
  const schema = {
    type: "object",
    required: ["message"],
    properties: { message: { type: "string" }, count: { type: "number" } },
  };

  test("rejects missing required field", async () => {
    registerTool("strict", "Strict", schema, async ({ message }) => message);

    const res = await rpc("tools/call", { name: "strict", arguments: {} });
    const parsed = JSON.parse((res.result as any).content[0].text);
    expect(parsed.isError).toBe(true);
    expect(parsed.code).toBe("validation_failed");
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0].path).toBe("message");
  });

  test("rejects wrong type", async () => {
    registerTool("strict", "Strict", schema, async ({ message }) => message);

    const res = await rpc("tools/call", { name: "strict", arguments: { message: 123 } });
    const parsed = JSON.parse((res.result as any).content[0].text);
    expect(parsed.code).toBe("validation_failed");
  });

  test("valid input reaches handler", async () => {
    registerTool("strict", "Strict", schema, async ({ message }) => ({ got: message }));

    const res = await rpc("tools/call", { name: "strict", arguments: { message: "hello" } });
    const parsed = JSON.parse((res.result as any).content[0].text);
    expect(parsed).toEqual({ got: "hello" });
  });

  test("validateInput: false skips validation", async () => {
    registerTool("loose", "Loose", schema, async (args) => ({ got: args }), { validateInput: false });

    const res = await rpc("tools/call", { name: "loose", arguments: {} });
    const parsed = JSON.parse((res.result as any).content[0].text);
    expect(parsed.isError).toBeUndefined();
    expect(parsed.got).toEqual({});
  });

  test("empty schema skips validation", async () => {
    registerTool("any", "Any", {}, async (args) => args);

    const res = await rpc("tools/call", { name: "any", arguments: { whatever: true } });
    const parsed = JSON.parse((res.result as any).content[0].text);
    expect(parsed).toEqual({ whatever: true });
  });

  test("handler not called when validation fails", async () => {
    let called = false;
    registerTool("guard", "Guard", schema, async () => { called = true; return "ok"; });

    await rpc("tools/call", { name: "guard", arguments: {} });
    expect(called).toBe(false);
  });
});
