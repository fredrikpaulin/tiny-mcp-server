# Changelog

## 0.4.0

### Added
- **Scanner module** (`src/modules/scanner.ts`): Directory scanner with JS/TS parser. Extracts functions, classes, interfaces, type aliases, imports, calls, side effects, and complexity metrics. Populates the Patterns graph automatically. Incremental via file hash caching. Watch mode for auto-rescan on file changes.
- **Query module** (`src/modules/query.ts`): Predicate-based query engine combining graph traversal and text search. Supports type, where (metadata predicates with gt/lt/gte/lte/exists/contains/in), near (proximity), relationship, search, sort, and limit filters.
- **Export module** (`src/modules/export.ts`): Graph export as DOT (Graphviz) or JSON with node type→shape mapping. Supports filtering by type, relationship, and proximity.
- **Diff module** (`src/modules/diff.ts`): Snapshot-based graph comparison. Detects added, removed, and changed nodes/edges via JSON fingerprinting. Snapshots stored in Recall.
- **Stats module** (`src/modules/stats.ts`): Aggregate metrics — complexity stats, most-connected nodes (top 10 by degree), hotspot detection (complexity × connectivity), and max dependency depth via BFS.
- **Refactor module** (`src/modules/refactor.ts`): Find all references to a symbol across the codebase graph. Traces definitions, call sites, imports, extends, and implements edges. Rename impact preview shows all affected files and nodes.
- **Barrel export** (`src/index.ts`): Re-exports all modules and types from a single entry point.
- **Error boundaries**: Tool execution catches errors with stack traces. Event emit wrapped in try/catch so one bad handler won't break others. Optional `toolTimeout` for tool execution deadlines via `Promise.race`.
- **Watch mode**: `scanner_watch` / `scanner_unwatch` tools. Debounced file system watching with `fs.watch` recursive. `close()` lifecycle cleans up watcher.
- **Example modules server** (`examples/modules.ts`): Complete working example loading all 9 modules.
- **New tests**: Parser tests (20), scanner enrichment tests (10), query tests (17), export tests (14), diff tests (9), stats tests (9), refactor tests (9).

### Fixed
- **Parser**: 11 bugs fixed — regex char class brackets, regex flags, findById cache invalidation, sentinel value consumed as identifier, multiple errors overwriting, nested generics `>>` closing, optional chaining `?.` marker, template literal scope check, `export type Foo = string` double-advancing, side effects not detected in variable initializers.
- **Integration tests**: Use `process.execPath` instead of hardcoded `"bun"` for subprocess spawning.

### Changed
- `package.json` entry point now uses `src/index.ts` barrel. `exports` field includes all modules and analyzer paths. `files` array lists all new modules.
- Patterns module gains `allEdges()` method for full edge enumeration.
- README updated with all new modules, documentation links, and complete module-stack example.

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
