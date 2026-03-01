# Testing

tiny-mcp-server is designed to be testable with `bun:test`. The library exports `handleRequest` and `_reset` specifically to support unit testing without spawning subprocesses.

## Setup

No extra dependencies needed — Bun includes a test runner.

```bash
bun test
```

## Unit Testing

### Basic pattern

Import `handleRequest` to test MCP methods directly and `_reset` to clean up between tests:

```ts
import { describe, expect, test, beforeEach } from "bun:test";
import { registerTool, handleRequest, _reset } from "tiny-mcp-server";

beforeEach(() => _reset());

const rpc = (method, params?) =>
  handleRequest({ jsonrpc: "2.0", id: 1, method, params });
```

`_reset()` clears all registered tools, resources, and templates. Always call it in `beforeEach` to prevent state leaking between tests.

### Testing a tool

```ts
test("greet tool returns greeting", async () => {
  registerTool("greet", "Greet someone", {
    type: "object",
    required: ["name"],
    properties: { name: { type: "string" } }
  }, async ({ name }) => ({ greeting: `Hello, ${name}!` }));

  const res = await rpc("tools/call", { name: "greet", arguments: { name: "World" } });
  const parsed = JSON.parse((res.result as any).content[0].text);
  expect(parsed).toEqual({ greeting: "Hello, World!" });
});
```

### Testing validation

```ts
test("greet tool rejects missing name", async () => {
  registerTool("greet", "Greet someone", {
    type: "object",
    required: ["name"],
    properties: { name: { type: "string" } }
  }, async ({ name }) => ({ greeting: `Hello, ${name}!` }));

  const res = await rpc("tools/call", { name: "greet", arguments: {} });
  const parsed = JSON.parse((res.result as any).content[0].text);
  expect(parsed.isError).toBe(true);
  expect(parsed.code).toBe("validation_failed");
  expect(parsed.errors[0].path).toBe("name");
});
```

### Testing ToolError

```ts
import { ToolError } from "tiny-mcp-server";

test("handler returns structured error", async () => {
  registerTool("fail", "Always fails", {}, async () => {
    throw new ToolError("not_found", "Resource missing");
  });

  const res = await rpc("tools/call", { name: "fail", arguments: {} });
  const parsed = JSON.parse((res.result as any).content[0].text);
  expect(parsed.code).toBe("not_found");
});
```

### Testing validateInput standalone

```ts
import { validateInput } from "tiny-mcp-server";

test("validates nested objects", () => {
  const schema = {
    type: "object",
    properties: {
      config: {
        type: "object",
        required: ["host"],
        properties: { host: { type: "string" } }
      }
    }
  };

  const errors = validateInput(schema, { config: {} });
  expect(errors[0]).toEqual({ path: "config.host", message: "required" });
});
```

## Integration Testing

For end-to-end tests that exercise the stdio transport, spawn your server as a subprocess:

```ts
import { describe, expect, test } from "bun:test";

async function createServer() {
  const proc = Bun.spawn(["bun", "run", "server.ts"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const send = async (msg) => {
    proc.stdin.write(JSON.stringify(msg) + "\n");
    proc.stdin.flush();
  };

  const readLine = async (timeout = 3000) => {
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const timer = setTimeout(() => reader.cancel(), timeout);
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value);
        const nl = buf.indexOf("\n");
        if (nl !== -1) {
          reader.releaseLock();
          return JSON.parse(buf.slice(0, nl));
        }
      }
    } finally { clearTimeout(timer); }
    throw new Error("No response");
  };

  const close = () => { proc.stdin.end(); proc.kill(); };
  return { send, readLine, close };
}

test("echo tool over stdio", async () => {
  const server = await createServer();
  try {
    await server.send({
      jsonrpc: "2.0", id: 1,
      method: "tools/call",
      params: { name: "echo", arguments: { message: "hello" } }
    });
    const res = await server.readLine();
    expect(JSON.parse(res.result.content[0].text)).toEqual({ echoed: "hello" });
  } finally {
    server.close();
  }
});
```

## File Structure

Tests mirror the source structure:

```
test/
  mcp.test.ts           # unit tests for all MCP methods
  integration.test.ts   # stdio transport tests
```

## Tips

- Always use `_reset()` in `beforeEach` — tools, resources, and templates are stored in module-level maps and persist across tests otherwise.
- `handleRequest` is synchronous from the caller's perspective (returns a Promise) but doesn't require the stdio transport, making it fast for unit tests.
- Mock external calls (databases, APIs, file system) in your tool handlers to keep tests fast and deterministic.
- For tools that use `sample()`, mock at the handler level since sampling requires an active stdio connection.
