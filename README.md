# tiny-mcp-server

A minimal [MCP](https://modelcontextprotocol.io) server implementation for Bun. No dependencies, ~100 lines.

## Install

```bash
bun install
```

## Usage

```ts
import { registerTool, registerResource, registerResourceTemplate, serve } from "./mcp";

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

serve({ name: "my-server", version: "1.0.0" });
```

## Run

```bash
bun src/index.ts
```

## Test

```bash
# Initialize
echo '{"jsonrpc":"2.0","id":1,"method":"initialize"}' | bun src/index.ts

# List tools
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | bun src/index.ts

# Call a tool
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"echo","arguments":{"message":"hello"}}}' | bun src/index.ts

# List resources
echo '{"jsonrpc":"2.0","id":1,"method":"resources/list"}' | bun src/index.ts

# Read a resource
echo '{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"info://server"}}' | bun src/index.ts
# Read a resource template
echo '{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"env://HOME"}}' | bun src/index.ts
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
| `handler` | `() => Promise<string>` | Async function returning content |

### `registerResourceTemplate(uriTemplate, name, description, mimeType, handler)`

Register a dynamic resource with URI variables.

| Param | Type | Description |
|-------|------|-------------|
| `uriTemplate` | `string` | URI pattern with `{var}` placeholders |
| `name` | `string` | Human-readable name |
| `description` | `string` | Human-readable description |
| `mimeType` | `string` | Content type |
| `handler` | `(vars) => Promise<string>` | Async function receiving extracted variables |

### `serve(options?)`

Start the MCP server on stdio.

| Param | Type | Description |
|-------|------|-------------|
| `options.name` | `string` | Server name (default: `"mcp-server"`) |
| `options.version` | `string` | Server version (default: `"1.0.0"`) |

## License

MIT
