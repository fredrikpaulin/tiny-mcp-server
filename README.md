# tiny-mcp-server

A minimal [MCP](https://modelcontextprotocol.io) server implementation for Bun. No dependencies, ~150 lines.

## Install

```bash
bun add tiny-mcp-server
```

## Usage

```ts
import { registerTool, registerResource, registerResourceTemplate, sample, serve } from "tiny-mcp-server";

// Register a tool
registerTool(
  "echo",
  "Echoes back the provided message",
  {
    type: "object",
    properties: {
      message: { type: "string", description: "Message to echo back" }
    },
    required: ["message"]
  },
  async ({ message }) => ({ echoed: message })
);

// Register a resource
registerResource(
  "info://server",
  "Server Info",
  "Basic server information",
  "application/json",
  async () => JSON.stringify({ name: "my-server", version: "1.0.0" })
);

// Register a resource template
registerResourceTemplate(
  "env://{name}",
  "Environment Variable",
  "Read an environment variable",
  "text/plain",
  async ({ name }) => process.env[name] || ""
);

// Use sampling inside a tool
registerTool(
  "summarize",
  "Summarize text using the client's LLM",
  {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"]
  },
  async ({ text }) => {
    const summary = await sample({
      messages: [{ role: "user", content: { type: "text", text: `Summarize: ${text}` } }],
      maxTokens: 200
    });
    return { summary };
  }
);

serve({ name: "my-server", version: "1.0.0" });
```

## Run

```bash
bun server.ts
```

## Test

```bash
# Initialize
echo '{"jsonrpc":"2.0","id":1,"method":"initialize"}' | bun server.ts

# List tools
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | bun server.ts

# Call a tool
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"echo","arguments":{"message":"hello"}}}' | bun server.ts

# List resources
echo '{"jsonrpc":"2.0","id":1,"method":"resources/list"}' | bun server.ts

# Read a resource
echo '{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"info://server"}}' | bun server.ts

# Read a resource template
echo '{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"env://HOME"}}' | bun server.ts
```

## API

### `registerTool(name, description, schema, handler)`

Register a tool that can be called by MCP clients.

| Param | Type | Description |
|-------|------|-------------|
| `name` | `string` | Tool identifier |
| `description` | `string` | Human-readable description |
| `schema` | `object` | JSON Schema for input validation |
| `handler` | `(params) => Promise<unknown>` | Async function to execute |

### `registerResource(uri, name, description, mimeType, handler)`

Register a resource that can be read by MCP clients.

| Param | Type | Description |
|-------|------|-------------|
| `uri` | `string` | Resource URI (e.g. `file://config.json`) |
| `name` | `string` | Human-readable name |
| `description` | `string` | Human-readable description |
| `mimeType` | `string` | Content type (e.g. `application/json`) |
| `handler` | `() => Promise<string \| Uint8Array>` | Async function returning content (text or binary) |

Text resources return strings, binary resources return `Uint8Array` (auto base64 encoded):

```ts
// Binary resource
registerResource(
  "image://logo",
  "Logo",
  "Company logo",
  "image/png",
  async () => Bun.file("logo.png").bytes()
);
```

### `registerResourceTemplate(uriTemplate, name, description, mimeType, handler)`

Register a dynamic resource with URI variables.

| Param | Type | Description |
|-------|------|-------------|
| `uriTemplate` | `string` | URI pattern with `{var}` placeholders |
| `name` | `string` | Human-readable name |
| `description` | `string` | Human-readable description |
| `mimeType` | `string` | Content type |
| `handler` | `(vars) => Promise<string \| Uint8Array>` | Async function receiving extracted variables |

### `sample(options)`

Request an LLM completion from the client. Can only be used inside tool/resource handlers after `serve()` is running.

| Param | Type | Description |
|-------|------|-------------|
| `options.messages` | `SampleMessage[]` | Conversation messages |
| `options.maxTokens` | `number` | Max tokens to generate (default: 1000) |
| `options.temperature` | `number` | Sampling temperature (optional) |
| `options.systemPrompt` | `string` | System prompt (optional) |

Returns `Promise<string>` with the assistant's response text.

```ts
const response = await sample({
  messages: [
    { role: "user", content: { type: "text", text: "Hello!" } }
  ],
  maxTokens: 100
});
```

### `serve(options?)`

Start the MCP server on stdio.

| Param | Type | Description |
|-------|------|-------------|
| `options.name` | `string` | Server name (default: `"mcp-server"`) |
| `options.version` | `string` | Server version (default: `"1.0.0"`) |

## License

MIT
