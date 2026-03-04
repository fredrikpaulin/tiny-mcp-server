# Changelog

## 0.3.0

### Added
- **Module framework**: Composable module system with automatic dependency resolution via topological sort. Modules are factory functions returning a `ModuleMetadata` object with `name`, optional `depends`, and an `init(ctx)` function. The shared `ModuleContext` lets modules register tools/resources and expose APIs to downstream modules.
- **`loadModules()`**: Resolves dependency order, initializes modules, and builds shared context.
- **`closeModules()`**: Calls module `close()` hooks in reverse initialization order for graceful shutdown.
- **Recall module** (`src/modules/recall.ts`): SQLite persistence via `bun:sqlite` with prepared statements. Provides `recall_save`, `recall_get`, `recall_query`, and `recall_delete` tools. Exposes `ctx.recall` API for other modules.
- **Patterns module** (`src/modules/patterns.ts`): Context graph builder with nodes, edges, and notes. Depends on Recall. Provides `patterns_add_node`, `patterns_add_edge`, `patterns_query`, and `patterns_add_note` tools. Exposes `ctx.patterns` API.
- **Beacon module** (`src/modules/beacon.ts`): Fast scored search across Recall data, Patterns graph nodes, and notes. Depends on Recall and Patterns. Provides `beacon_search` tool. Exposes `ctx.beacon` API.
- **Module documentation**: `docs/modules.md` (framework guide), `docs/modules-recall.md`, `docs/modules-patterns.md`, `docs/modules-beacon.md`.
- **Module tests**: 34 new tests covering framework mechanics (dependency resolution, circular detection, shared context, close ordering) and tool-level tests for all three modules.

### Changed
- `_reset()` now also clears loaded module state.
- `package.json` `files` array includes module source files.
- README updated with Module Framework section and documentation links.

## 0.2.0

### Added
- **Streaming tool responses**: Tool handlers can now be async generators (`async function*`). Each yielded string chunk is sent to the client as a `notifications/tools/progress` JSON-RPC notification, and the final response contains the full concatenated text. Backward compatible — regular async handlers work unchanged.

### Changed
- `handleRequest()` accepts an optional second `write` callback parameter for streaming notifications.
- `ToolHandler` type now accepts both `Promise<unknown>` and `AsyncGenerator<string>` return types.

## 0.1.0

### Added
- **Input validation**: Tool inputs are now validated against their JSON Schema before the handler runs. Covers `type`, `required`, `properties` (recursive), `enum`, `items`, `minimum`/`maximum`, `minLength`/`maxLength`. Validation can be disabled per tool with `{ validateInput: false }`.
- **ToolError class**: Exported error class with a string `code` field for structured error responses. Handler errors now include `code` in the response (`"internal_error"` for plain errors, or a custom code for `ToolError`).
- **validateInput()**: Exported function for standalone use outside the request lifecycle.
- **handleRequest()**: Exported for direct unit testing.
- **_reset()**: Exported helper to clear registrations between tests.
- **Test suite**: Comprehensive test coverage with `bun:test` — unit tests for all MCP methods, validation, and ToolError, plus integration tests over stdio transport.
- **Documentation**: Added `docs/` folder with full API reference, guides for validation, error handling, resources, sampling, and testing, plus a HOWTO for AI agents implementing a server.

### Changed
- `registerTool()` accepts an optional 5th `options` parameter (`{ validateInput?: boolean }`).
- Error responses from tool handlers now include a `code` field alongside `isError` and `error`.
- README.md rewritten as a concise overview and getting started guide, with detailed docs moved to `docs/`.

## 0.0.1

Initial release — JSON-RPC over stdio, tool/resource/resource-template registration, sampling support.
