# tiny-mcp-server

Modular toolkit for building [MCP](https://modelcontextprotocol.io) servers on Bun — persistent context graph, incremental code scanning, full-text search, and built-in input validation. No dependencies.

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

**Streaming** — Use async generator handlers to stream text chunks to the client as notifications. The final response contains the complete text. Backward compatible — regular handlers work unchanged.

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

## Module Framework

Pick the built-in modules you need, drop the ones you don't, and add your own. Each module is a factory function that registers tools and exposes APIs to other modules via a shared context. Dependencies are resolved automatically.

```ts
import { loadModules, serve } from "tiny-mcp-server";
import recall from "tiny-mcp-server/src/modules/recall";
import patterns from "tiny-mcp-server/src/modules/patterns";
import beacon from "tiny-mcp-server/src/modules/beacon";
import scanner from "tiny-mcp-server/src/modules/scanner";
import query from "tiny-mcp-server/src/modules/query";
import graphExport from "tiny-mcp-server/src/modules/export";
import diff from "tiny-mcp-server/src/modules/diff";
import stats from "tiny-mcp-server/src/modules/stats";
import refactor from "tiny-mcp-server/src/modules/refactor";
import prompt from "tiny-mcp-server/src/modules/prompt";

await loadModules([
  recall({ dbPath: "./data.db" }),
  patterns(),
  beacon(),
  scanner(),
  query(),
  graphExport(),
  diff(),
  stats(),
  refactor(),
  prompt(),
]);

serve({ name: "my-server", version: "1.0.0" });
```

Modules are loaded in dependency order automatically via topological sort.

**Built-in modules:**

- **Recall** — SQLite persistence with key-value storage, namespaces, and pattern queries
- **Patterns** — Context graph (nodes, edges, notes, traversal, shortest path) for mapping project structure
- **Beacon** — Full-text search across all stored context with BM25 scoring
- **Scanner** — Directory scanner with JS/TS parser extracting functions, classes, interfaces, imports, calls, side effects, and complexity metrics. Supports watch mode for auto-rescan.
- **Query** — Predicate-based query engine combining graph traversal and text search with filtering, sorting, and limiting
- **Export** — Graph export as DOT (Graphviz) or JSON with filtering by node type, relationship, or proximity
- **Diff** — Snapshot-based graph comparison detecting added, removed, and changed nodes/edges
- **Stats** — Aggregate metrics: complexity stats, most-connected nodes, hotspot detection, dependency depth
- **Refactor** — Find all references to a symbol across files and preview rename impact
- **Prompt** — Build minimal LLM context from the graph: extracts focus function, dependencies, callers, and types as a compact prompt with token budgeting

**Custom modules** can depend on any built-in module and access its API through the shared context. For example, a module that stores data in Recall or adds nodes to the Patterns graph only needs to declare the dependency:

```ts
export default function myModule() {
  return {
    name: "my-module",
    depends: ["recall", "patterns"],
    init(ctx) {
      ctx.registerTool("my_tool", "Does something useful", schema, async (args) => {
        ctx.recall.set("my-ns", args.key, args.value);
        ctx.patterns.addNode({ id: args.id, type: "custom", metadata: {} });
        return { ok: true };
      });
    },
  };
}
```

See [Module Framework](docs/modules.md) for the full guide.

## Documentation

- [API Reference](docs/api.md) — Complete reference for all exports
- [Input Validation](docs/validation.md) — Supported schema keywords, error format, opting out
- [Error Handling](docs/errors.md) — ToolError, error codes, patterns
- [Resources](docs/resources.md) — Static resources, templates, binary content
- [Streaming](docs/streaming.md) — Async generator handlers for streaming responses
- [Sampling](docs/sampling.md) — Requesting LLM completions from the client
- [Testing](docs/testing.md) — Unit and integration testing with bun:test
- [Module Framework](docs/modules.md) — Writing and loading composable modules
- [Recall Module](docs/modules-recall.md) — SQLite persistence module
- [Patterns Module](docs/modules-patterns.md) — Context graph module
- [Beacon Module](docs/modules-beacon.md) — Context search module
- [Scanner Module](docs/modules-scanner.md) — Directory scanning and code analysis
- [Query Module](docs/modules-query.md) — Predicate-based graph queries
- [Export Module](docs/modules-export.md) — DOT and JSON graph export
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
