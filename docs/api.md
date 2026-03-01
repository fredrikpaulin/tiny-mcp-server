# API Reference

Complete reference for all exports from `tiny-mcp-server`.

## registerTool(name, description, schema, handler, options?)

Register a tool that MCP clients can discover and call.

```ts
import { registerTool } from "tiny-mcp-server";

registerTool(
  "greet",
  "Greet someone by name",
  {
    type: "object",
    properties: {
      name: { type: "string", description: "Name to greet" }
    },
    required: ["name"]
  },
  async ({ name }) => ({ greeting: `Hello, ${name}!` })
);
```

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `name` | `string` | Unique tool identifier |
| `description` | `string` | Human-readable description shown to clients |
| `schema` | `object` | JSON Schema defining the tool's input shape |
| `handler` | `(params: Record<string, unknown>) => Promise<unknown>` | Async function that executes the tool |
| `options` | `ToolOptions` | Optional configuration (see below) |

**Options:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `validateInput` | `boolean` | `true` | Validate arguments against `schema` before calling handler |

The handler receives the parsed `arguments` object from the MCP `tools/call` request. Whatever the handler returns is JSON-stringified and sent back as a text content block.

If a tool is registered with the same name as an existing tool, it replaces the previous registration.

## registerResource(uri, name, description, mimeType, handler)

Register a static resource that clients can read.

```ts
import { registerResource } from "tiny-mcp-server";

registerResource(
  "info://server",
  "Server Info",
  "Basic server information",
  "application/json",
  async () => JSON.stringify({ name: "my-server", version: "1.0.0" })
);
```

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `uri` | `string` | Resource URI (e.g. `info://server`, `file://config.json`) |
| `name` | `string` | Human-readable name |
| `description` | `string` | Human-readable description |
| `mimeType` | `string` | Content type (e.g. `application/json`, `text/plain`) |
| `handler` | `() => Promise<string \| Uint8Array>` | Async function returning content |

String return values are sent as text. `Uint8Array` return values are base64-encoded automatically, which is useful for binary resources:

```ts
registerResource(
  "image://logo",
  "Logo",
  "Company logo",
  "image/png",
  async () => Bun.file("logo.png").bytes()
);
```

## registerResourceTemplate(uriTemplate, name, description, mimeType, handler)

Register a dynamic resource with URI variables. Variables in the URI template are extracted and passed to the handler.

```ts
import { registerResourceTemplate } from "tiny-mcp-server";

registerResourceTemplate(
  "db://{schema}/{table}",
  "Database Table",
  "Read a database table",
  "application/json",
  async ({ schema, table }) => JSON.stringify(await queryTable(schema, table))
);
```

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `uriTemplate` | `string` | URI pattern with `{variable}` placeholders |
| `name` | `string` | Human-readable name |
| `description` | `string` | Human-readable description |
| `mimeType` | `string` | Content type |
| `handler` | `(vars: Record<string, string>) => Promise<string \| Uint8Array>` | Async function receiving extracted variables |

Template variables use greedy matching — `path://{file}` matched against `path://a/b/c` will pass `file: "a/b/c"`.

When a URI matches both a static resource and a template, the static resource takes priority.

## ToolError

Exported error class for structured error responses from tool handlers. Allows clients to distinguish between error types.

```ts
import { ToolError } from "tiny-mcp-server";

registerTool("read_project", "Read a project", schema, async ({ project }) => {
  const exists = await checkExists(project);
  if (!exists) throw new ToolError("not_found", `Project "${project}" doesn't exist`);
  return await loadProject(project);
});
```

**Constructor:** `new ToolError(code: string, message: string)`

| Param | Type | Description |
|-------|------|-------------|
| `code` | `string` | Machine-readable error code (e.g. `"not_found"`, `"permission_denied"`) |
| `message` | `string` | Human-readable error message |

When a handler throws a `ToolError`, the response includes the code:
```json
{ "isError": true, "code": "not_found", "error": "Error: Project \"foo\" doesn't exist" }
```

Plain `Error` throws get `code: "internal_error"` automatically.

See [Error Handling](errors.md) for patterns and conventions.

## validateInput(schema, value, path?)

Validate a value against a JSON Schema. Used internally by `tools/call` but exported for standalone use.

```ts
import { validateInput } from "tiny-mcp-server";

const errors = validateInput(
  { type: "object", required: ["name"], properties: { name: { type: "string" } } },
  { name: 42 }
);
// [{ path: "name", message: "expected string, got number" }]
```

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `schema` | `Record<string, unknown>` | JSON Schema object |
| `value` | `unknown` | Value to validate |
| `path` | `string` | Optional path prefix for error reporting (default: `""`) |

**Returns:** `Array<{ path: string, message: string }>` — empty array means valid.

See [Input Validation](validation.md) for supported keywords and examples.

## sample(options)

Request an LLM completion from the MCP client. This sends a `sampling/createMessage` request over the transport and waits for the client's response. Can only be used after `serve()` is running.

```ts
import { sample } from "tiny-mcp-server";

const response = await sample({
  messages: [{ role: "user", content: { type: "text", text: "Summarize this text..." } }],
  maxTokens: 200,
  temperature: 0.7,
  systemPrompt: "You are a concise summarizer."
});
```

**Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `options.messages` | `SampleMessage[]` | required | Conversation messages |
| `options.maxTokens` | `number` | `1000` | Maximum tokens to generate |
| `options.temperature` | `number` | omitted | Sampling temperature |
| `options.systemPrompt` | `string` | omitted | System prompt |

**Returns:** `Promise<string>` — the assistant's response text.

See [Sampling](sampling.md) for usage patterns.

## serve(options?)

Start the MCP server on stdio. This blocks and reads from stdin indefinitely. Call this after registering all tools and resources.

```ts
import { serve } from "tiny-mcp-server";

serve({ name: "my-server", version: "1.0.0" });
```

**Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `options.name` | `string` | `"mcp-server"` | Server name returned in `initialize` response |
| `options.version` | `string` | `"1.0.0"` | Server version returned in `initialize` response |

## handleRequest(req)

Process a single JSON-RPC request and return the response. Exported primarily for unit testing — in production, `serve()` calls this internally.

```ts
import { handleRequest } from "tiny-mcp-server";

const response = await handleRequest({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/list"
});
```

## _reset()

Clear all registrations and reset internal state. For testing only.

```ts
import { _reset } from "tiny-mcp-server";
import { beforeEach } from "bun:test";

beforeEach(() => _reset());
```
