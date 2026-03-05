# HOWTO: Implement tiny-mcp-server in an AI Agent Project

This guide is written for AI agents (Claude, GPT, Codex, etc.) that are asked to build an MCP server using the tiny-mcp-server toolkit. It covers the full implementation path: setup, tool design, error handling, validation, resources, sampling, and testing.

## Prerequisites

- Bun runtime (not Node.js)
- `bun add tiny-mcp-server`

## Step 1: Scaffold the Server

Create a single entry point file. All registration happens at the top level, `serve()` goes at the bottom:

```ts
import {
  registerTool,
  registerResource,
  registerResourceTemplate,
  ToolError,
  sample,
  serve
} from "tiny-mcp-server";

// --- tools go here ---

// --- resources go here ---

serve({ name: "my-server", version: "1.0.0" });
```

The server communicates over stdio using JSON-RPC. The MCP client (e.g. Claude Desktop) spawns this process and sends/receives newline-delimited JSON.

## Step 2: Register Tools

Each tool needs a name, description, JSON Schema for its input, and an async handler function.

```ts
registerTool(
  "search_files",
  "Search for files matching a pattern",
  {
    type: "object",
    required: ["pattern"],
    properties: {
      pattern: { type: "string", description: "Glob pattern to match" },
      maxResults: { type: "integer", minimum: 1, maximum: 100, description: "Max results to return" }
    }
  },
  async ({ pattern, maxResults }) => {
    const glob = new Bun.Glob(pattern);
    const results = [];
    for await (const path of glob.scan(".")) {
      results.push(path);
      if (maxResults && results.length >= maxResults) break;
    }
    return { files: results, count: results.length };
  }
);
```

### Key points for AI agents:

1. **The schema IS the validation.** tiny-mcp-server validates inputs against the schema before calling your handler. You do not need to check `if (!pattern) throw ...` — a `required` field in the schema handles this. Supported schema keywords: `type`, `required`, `properties`, `enum`, `items`, `minimum`, `maximum`, `minLength`, `maxLength`.

2. **The handler receives a plain object.** The `arguments` from the MCP `tools/call` request are passed directly. Types are whatever JSON parsed to (string, number, boolean, array, object, null).

3. **Return any JSON-serializable value.** The return value is `JSON.stringify`'d and sent as a text content block. Return objects, arrays, strings, numbers — whatever makes sense.

4. **Throw ToolError for expected failures.** Use `ToolError` when the error is something the client should handle (not found, invalid state, permission denied):

```ts
import { ToolError } from "tiny-mcp-server";

if (!project) throw new ToolError("not_found", `Project "${name}" doesn't exist`);
```

5. **Let unexpected errors propagate.** If something genuinely unexpected happens (bug, runtime error), just let it throw. The server catches it and returns `code: "internal_error"` automatically.

6. **Opt out of validation when needed.** If a tool accepts arbitrary input or does its own validation:

```ts
registerTool("eval", "Evaluate expression", schema, handler, { validateInput: false });
```

## Step 3: Register Resources (Optional)

Resources expose read-only data to clients. Use them for configuration, metadata, or reference data.

### Static resources

```ts
registerResource(
  "info://server",
  "Server Info",
  "Server metadata",
  "application/json",
  async () => JSON.stringify({ name: "my-server", tools: 12 })
);
```

### Resource templates

For dynamic data addressable by URI:

```ts
registerResourceTemplate(
  "project://{name}",
  "Project",
  "Project details by name",
  "application/json",
  async ({ name }) => {
    const project = await loadProject(name);
    if (!project) throw new Error(`Project "${name}" not found`);
    return JSON.stringify(project);
  }
);
```

Template variables are extracted by greedy regex — `file://{path}` will capture `file://a/b/c.txt` as `path: "a/b/c.txt"`.

### Binary resources

Return `Uint8Array` for binary content (auto base64-encoded):

```ts
registerResource("image://logo", "Logo", "App logo", "image/png",
  async () => await Bun.file("assets/logo.png").bytes()
);
```

## Step 4: Use Sampling (Optional)

Sampling lets your tools call the client's LLM. This is powerful for AI-proxying tools.

```ts
import { sample } from "tiny-mcp-server";

registerTool("rewrite", "Rewrite text in a given style", {
  type: "object",
  required: ["text", "style"],
  properties: {
    text: { type: "string" },
    style: { type: "string", enum: ["formal", "casual", "technical"] }
  }
}, async ({ text, style }) => {
  const rewritten = await sample({
    messages: [{ role: "user", content: { type: "text", text: `Rewrite this in a ${style} style:\n\n${text}` } }],
    maxTokens: 500,
    systemPrompt: `You are an expert writer. Rewrite text in a ${style} style.`
  });
  return { rewritten };
});
```

### Caveats:

- `sample()` only works after `serve()` starts (needs the stdio transport)
- There's no built-in timeout — wrap with `Promise.race` if needed
- The client controls model selection, costs, and rate limits
- Not all clients support sampling

## Step 5: Write Tests

Use `bun:test`. Import `handleRequest` for unit tests and `_reset` to clear state:

```ts
import { describe, expect, test, beforeEach } from "bun:test";
import { registerTool, handleRequest, ToolError, _reset } from "tiny-mcp-server";

beforeEach(() => _reset());

const rpc = (method, params?) =>
  handleRequest({ jsonrpc: "2.0", id: 1, method, params });

describe("search_files", () => {
  beforeEach(() => {
    registerTool("search_files", "Search files", {
      type: "object",
      required: ["pattern"],
      properties: { pattern: { type: "string" } }
    }, async ({ pattern }) => ({ files: [`${pattern}.txt`], count: 1 }));
  });

  test("returns matching files", async () => {
    const res = await rpc("tools/call", { name: "search_files", arguments: { pattern: "test" } });
    const parsed = JSON.parse((res.result as any).content[0].text);
    expect(parsed.files).toContain("test.txt");
  });

  test("rejects missing pattern", async () => {
    const res = await rpc("tools/call", { name: "search_files", arguments: {} });
    const parsed = JSON.parse((res.result as any).content[0].text);
    expect(parsed.code).toBe("validation_failed");
  });
});
```

### What to test:

- **Happy path** — tool returns expected result for valid input
- **Validation** — missing required fields, wrong types, enum violations
- **ToolError** — handler throws ToolError with expected code
- **Edge cases** — empty arrays, null values, boundary numbers
- **Resources** — text and binary resources return correct format
- **Integration** — spawn the server and test over stdio (see [Testing](testing.md))

## Step 6: Configure for MCP Client

The server is launched by the MCP client. For Claude Desktop, add to the config:

```json
{
  "mcpServers": {
    "my-server": {
      "command": "bun",
      "args": ["run", "/path/to/server.ts"]
    }
  }
}
```

## Complete Example

Here's a minimal but complete server with two tools, a resource, and proper error handling:

```ts
import { registerTool, registerResource, ToolError, serve } from "tiny-mcp-server";

const projects = new Map();

registerTool("create_project", "Create a new project", {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 100 },
    description: { type: "string", maxLength: 500 }
  }
}, async ({ name, description }) => {
  if (projects.has(name)) throw new ToolError("already_exists", `Project "${name}" already exists`);
  const project = { name, description: description || "", createdAt: new Date().toISOString() };
  projects.set(name, project);
  return project;
});

registerTool("get_project", "Get project details", {
  type: "object",
  required: ["name"],
  properties: { name: { type: "string" } }
}, async ({ name }) => {
  const project = projects.get(name);
  if (!project) throw new ToolError("not_found", `Project "${name}" not found`);
  return project;
});

registerResource(
  "info://projects",
  "Project List",
  "List all project names",
  "application/json",
  async () => JSON.stringify([...projects.keys()])
);

serve({ name: "project-manager", version: "1.0.0" });
```

## Architecture Guidelines

When building a larger server (10+ tools):

1. **One file per domain.** Group related tools in separate files, import and register in the entry point.

2. **Schema as source of truth.** Define schemas as constants and reference them. The schema is both documentation and runtime validation.

3. **Flat over nested.** Prefer simple tool schemas. Deeply nested objects are harder for AI clients to construct correctly.

4. **Use ToolError codes consistently.** Pick a small set of codes (`not_found`, `already_exists`, `invalid_state`, `permission_denied`) and use them everywhere.

5. **Test validation and errors, not just happy paths.** The most common bugs in MCP servers are mismatched schemas, missing error handling, and incorrect response formats.

6. **Keep handlers concise.** The handler should be a thin layer between MCP and your domain logic. Put business logic in separate functions.
