# tiny-mcp-server

A minimal [MCP](https://modelcontextprotocol.io) server implementation for Bun. No dependencies, single file, built-in input validation.

## Install

```bash
bun add tiny-mcp-server
```

## Quick Start

```ts
import { registerTool, registerResource, ToolError, serve } from "tiny-mcp-server";

registerTool(
  "greet",
  "Greet someone by name",
  {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string", minLength: 1 }
    }
  },
  async ({ name }) => ({ greeting: `Hello, ${name}!` })
);

registerResource(
  "info://server",
  "Server Info",
  "Basic server information",
  "application/json",
  async () => JSON.stringify({ name: "my-server", version: "1.0.0" })
);

serve({ name: "my-server", version: "1.0.0" });
```

Run it:

```bash
bun server.ts
```

That's it — you have a working MCP server with automatic input validation, structured errors, and stdio transport.

## Features

**Tools** — Register async functions as MCP tools with JSON Schema input definitions. Clients discover tools via `tools/list` and call them via `tools/call`.

**Input validation** — Tool arguments are validated against their JSON Schema before the handler runs. Supports `type`, `required`, `properties`, `enum`, `items`, `minimum`/`maximum`, `minLength`/`maxLength`. No dependencies.

**Structured errors** — Throw `ToolError` with a code like `"not_found"` or `"permission_denied"` so clients can handle errors programmatically instead of parsing strings.

**Resources** — Expose read-only data via static URIs or dynamic URI templates with variable extraction.

**Sampling** — Request LLM completions from the connected client inside your tool handlers, without needing your own API keys.

## Test It

```bash
# Initialize
echo '{"jsonrpc":"2.0","id":1,"method":"initialize"}' | bun server.ts

# List tools
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | bun server.ts

# Call a tool
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"greet","arguments":{"name":"World"}}}' | bun server.ts
```

## Run Tests

```bash
bun test
```

## Documentation

- [API Reference](docs/api.md) — Complete reference for all exports
- [Input Validation](docs/validation.md) — Supported schema keywords, error format, opting out
- [Error Handling](docs/errors.md) — ToolError, error codes, patterns
- [Resources](docs/resources.md) — Static resources, templates, binary content
- [Sampling](docs/sampling.md) — Requesting LLM completions from the client
- [Testing](docs/testing.md) — Unit and integration testing with bun:test
- [AI Agent HOWTO](docs/HOWTO-AI-AGENTS.md) — Step-by-step guide for AI agents implementing a server

## MCP Client Configuration

For Claude Desktop, add to your config:

```json
{
  "mcpServers": {
    "my-server": {
      "command": "path/to/bun",
      "args": ["run", "/path/to/server.ts"]
    }
  }
}
```

## License

MIT
