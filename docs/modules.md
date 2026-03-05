# Module Framework

Modules organize related functionality into composable units with automatic dependency resolution. A module is a factory function that returns a plain object declaring its name, dependencies, and an init function that registers tools/resources and exposes APIs.

## Module Definition

```ts
import type { ModuleMetadata, ModuleContext } from "tiny-mcp-server";

export default function myModule(config = {}) {
  return {
    name: "my-module",
    depends: ["other-module"],   // optional
    init(ctx) {
      // Register tools
      ctx.registerTool("my_tool", "Description", { type: "object" }, async () => ({}));
      // Expose API to other modules
      ctx.myAPI = { doSomething() { /* ... */ } };
    },
    close() {
      // Optional cleanup (close DBs, etc.)
    },
  } satisfies ModuleMetadata;
}
```

### Module Contract

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | yes | Unique identifier |
| `depends` | `string[]` | no | Module names this depends on |
| `schema` | `object` | no | JSON Schema for config validation |
| `init` | `(ctx) => void \| Promise<void>` | yes | Setup function |
| `close` | `() => void \| Promise<void>` | no | Cleanup function |

### Module Context

The `ctx` object passed to `init()`:

| Property | Description |
|----------|-------------|
| `registerTool` | Register an MCP tool |
| `registerResource` | Register a static resource |
| `registerResourceTemplate` | Register a resource template |
| `validateInput` | Validate data against JSON Schema |
| `ToolError` | Error class for tool failures |
| `sample` | Request LLM completion from client |
| `on(event, handler)` | Subscribe to an event |
| `off(event, handler)` | Unsubscribe from an event |
| `emit(event, ...args)` | Emit an event to all subscribers |
| `[key]` | Any API exposed by earlier modules |

## Loading Modules

```ts
import { loadModules, serve } from "tiny-mcp-server";
import recall from "tiny-mcp-server/src/modules/recall";
import patterns from "tiny-mcp-server/src/modules/patterns";
import beacon from "tiny-mcp-server/src/modules/beacon";

await loadModules([
  recall({ dbPath: "./data.db" }),
  patterns(),
  beacon({ maxResults: 50 }),
]);

serve({ name: "my-server", version: "1.0.0" });
```

Pass order doesn't matter — dependencies are resolved automatically via topological sort.

## Config via Constructor

Each module is a factory function. Config is passed as constructor arguments:

```ts
// Config baked into the module instance
recall({ dbPath: "/tmp/memory.db" })

// No config needed
patterns()

// Optional config with defaults
beacon({ maxResults: 10 })
```

## Cleanup

Call `closeModules()` for graceful shutdown. Close hooks run in reverse initialization order:

```ts
import { closeModules } from "tiny-mcp-server";

process.on("SIGTERM", async () => {
  await closeModules();
  process.exit(0);
});
```

## Events

Modules communicate through a lightweight event bus on the context. Any module can emit events and any module can listen for them.

```ts
// In a producer module
init(ctx) {
  ctx.emit("mymodule:dataChanged", { key: "foo" });
}

// In a consumer module
init(ctx) {
  ctx.on("mymodule:dataChanged", (data) => {
    console.log("Changed:", data.key);
  });
}
```

Convention: prefix event names with the module name (e.g. `recall:set`, `patterns:nodeAdded`).

### Built-in Events

| Event | Emitted by | Payload |
|-------|-----------|---------|
| `recall:set` | Recall | `{ key, value }` |
| `recall:delete` | Recall | `{ key }` |
| `patterns:nodeAdded` | Patterns | `{ id, type, name, metadata }` |
| `patterns:edgeAdded` | Patterns | `{ from, to, relationship, metadata }` |
| `patterns:noteAdded` | Patterns | `{ entity, note }` |
| `modules:ready` | Framework | *(none)* |

`modules:ready` fires once after all modules have finished initializing. Use it for work that needs all module APIs to be available — for example, Beacon uses it to build its initial FTS index so it captures any data seeded by other modules during init.

Beacon listens for the data change events above and marks its FTS index as dirty. The index is rebuilt lazily before the next search, so bulk inserts don't trigger repeated reindexing.

## Error Handling

| Scenario | Error |
|----------|-------|
| Module A depends on B, but B not provided | `Missing module: B` |
| A depends on B, B depends on A | `Circular dependency detected: A` |
| Module init throws | `Failed to initialize module "name": <message>` |

## Testing Modules

Use `_reset()` in `beforeEach` to clear all state between tests:

```ts
import { _reset, loadModules, handleRequest } from "tiny-mcp-server";

const rpc = (method, params?) =>
  handleRequest({ jsonrpc: "2.0", id: 1, method, params });

beforeEach(() => {
  _reset();
});

test("my module works", async () => {
  await loadModules([myModule()]);
  const res = await rpc("tools/call", { name: "my_tool", arguments: {} });
  // assert...
});
```

## Writing a Custom Module

1. Create a factory function that returns `ModuleMetadata`
2. Declare dependencies in `depends` if you need other modules' APIs
3. Use `ctx.registerTool()` etc. in `init()` to add MCP capabilities
4. Expose shared APIs on `ctx` for downstream modules
5. Implement `close()` if you need cleanup (database handles, file handles, etc.)

```ts
export default function logger(config: { level?: string } = {}) {
  const level = config.level || "info";
  return {
    name: "logger",
    init(ctx) {
      ctx.logger = {
        log(msg) { console.error(`[${level}] ${msg}`); },
      };
      ctx.registerTool("log", "Write a log message", {
        type: "object",
        required: ["message"],
        properties: { message: { type: "string" } },
      }, async ({ message }) => {
        ctx.logger.log(message);
        return { ok: true };
      });
    },
  };
}
```
