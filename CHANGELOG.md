# Changelog

## 0.4.5

Correctness pass over tickets 011, 012 and part of 009. No performance claims here — the measurable work landed in 0.4.4.

### Fixed
- **`patterns_traverse` returned duplicate edges.** With `direction: "both"`, an edge between two visited nodes was collected once from each endpoint, so callers got every edge twice. Edges are now keyed on source, target and relationship. Parallel edges with different relationships are still returned separately.
- **Outgoing requests could never settle.** `sendRequest` had no deadline, so a client that never answered a `sampling/createMessage` left the promise pending forever and leaked its `pendingRequests` entry — one per attempt. `ServerOptions.requestTimeout` gives it a deadline, rejecting with a `ToolError` coded `request_timeout`. Default off, matching `toolTimeout`. The timer is cleared on the first settle and unrefs itself, so it never holds the process open.
- **`scanner.ts` contained a raw NUL byte.** `EDGE_SEP` was written as a literal control character rather than `"\0"`, which made the file binary to `grep`, `rg` and `git diff` — a search across `src/` silently skipped the largest module in the project. Same value, same cache format, no behavioural change.

### Changed
- `handleRequest` dispatches through a method table instead of seven sequential `if (method === ...)` blocks. Behaviour is identical, including error codes for unknown methods and unknown tools.

### Added
- Tests: `traverse` edge deduplication (5), outgoing request timeout (5), scanner cache edge-key format (3). 333 tests to 346.

### Known issues
- **`sample()` cannot complete over the stdio transport.** `serve()` awaits `handleRequest` inside the stdin read loop, so a handler waiting on a sampling reply blocks the very stream that reply arrives on. Present in every released version, not a regression. `requestTimeout` above converts the hang into a clean error but does not fix it. Tracked as ticket 013.

## 0.4.4

Performance and correctness release from a follow-up audit (`project/audits/2026-08-11-AUDIT-0.4.3-followup.md`), tickets 001–006. Measured on a 1,001-file synthetic project (8,000 nodes, 16,000 edges):

| | 0.4.3 | 0.4.4 |
|---|---|---|
| First `beacon_search` after a scan | 45,608 ms | 93 ms |
| `beacon_reindex` | 16,046 ms | 158 ms |
| Cold `scanner_scan` | 2,188 ms | 1,180 ms |
| Warm `beacon_search` | 11 ms | 1.5 ms |
| Database size | 15.2 MB | 7.4 MB |

### Fixed
- **Multi-byte characters were corrupted at stdin chunk boundaries.** `serve()` decoded each chunk as a complete stream, so a UTF-8 sequence split across a 256 KiB read decoded to U+FFFD — `Pålin` arrived as `P��lin`. The damaged line was still valid JSON, so nothing raised an error. `TextDecoder` now decodes with `{ stream: true }`.
- **`query_find` returned nothing when `search` and `where` were combined.** Beacon's result `value` is polymorphic by type, and the whole value was being assigned to `metadata`, nesting a node's real metadata one level too deep. Every predicate then compared against `undefined`. `{ search: "handler", where: { complexity: { gt: 5 } } }` returned 0 results where the same predicate under `type` returned 5. Candidates from the search branch are now normalised per result type, which also fixes `name` carrying the node id instead of the node name.
- **Beacon index writes scanned the whole index.** `key` is `UNINDEXED` in both FTS tables, so `DELETE ... WHERE key = ?` was a full scan: every upsert cost O(documents) and a flush O(documents²) — 223 µs/doc at 500 documents, 1,465 µs/doc at 4,000. A `beacon_docs` table maps each key to a rowid and deletes address the rowid, which is flat at 13 µs/doc.
- **`beacon.search` reported timings that excluded its own work.** The clock started after `ensureIndexed()` and `flush()`, so a 9,501 ms call reported `total_ms: 5.24`. `total_ms` now covers the whole call and a new `index_ms` field reports index maintenance separately.
- **Module bookkeeping was indexed as searchable content.** Scanner's file hashes and graph slices went through `recall.namespace()`, which emits `recall:set`, which Beacon indexes. On a 301-file project that was 602 of 3,605 indexed documents and every byte of indexed description text, ranking against real code — a search for `handler7` returned `scanner:slice:m7.ts` as its second hit. It also meant `recall_query` with pattern `%` handed the consumer server internals mixed in with their own data.
- **`reindex()` fetched every node twice.** `patterns.query({})` already returns parsed nodes with metadata; the rebuild loop called `getNode` again for each one.
- **`reindex()` leaked a prepared statement per call** by preparing its notes query inline instead of holding it.

### Changed
- **Recall runs in WAL with `synchronous = NORMAL`.** `bun:sqlite` sets no PRAGMAs, so a file-backed database was on `journal_mode = delete` and `synchronous = FULL`. Note that WAL leaves `-wal` and `-shm` files beside the database; copying the `.db` alone can lose committed writes.
- **Beacon batches index writes.** `flush()` and `reindex()` each run in a `db.transaction()` instead of committing per statement. The empty-queue check stays outside, so an idle search opens no transaction.
- Beacon no longer skips keys prefixed `patterns:`. Nothing ever wrote them — Patterns uses its own tables — so the filter only served to silently drop a consumer key that happened to share the prefix.

### Added
- **`RecallAPI.internal(prefix)`** — same shape as `namespace(prefix)`, backed by a separate `recall_internal` table. Writes emit no events and never appear in `query()`. Scanner, Prompt and Diff use it for their bookkeeping. Databases written by earlier versions have their bookkeeping rows moved out of `recall_data` the first time the owning module claims its prefix, so no migration step is needed.
- `BeaconSearchResponse.timing.index_ms`.
- Tests: stdin chunk-boundary encoding (5), SQLite configuration and write batching (5), Beacon rowid mapping including a scaling assertion (8), search timing decomposition (6), `recall.internal` isolation and migration (10), `query_find` search filters (10). 289 tests to 333.
- `bench/audit-criteria.ts`, which reproduces the audit's measurements against a directory of your choosing.

## 0.4.3

Maintenance release addressing a codebase audit. No new features; the public tool surface is unchanged.

### Fixed
- **Analyzer exports**: `./analyzer/*` advertised an `analyze.js` orchestrator that imported analysis modules which don't exist in the package, so `import("tiny-mcp-server/analyzer/analyze")` half-resolved and then crashed at runtime. Narrowed the export map to the four supported files (`parser`, `ast`, `lexer`, `tokens`) and removed the broken orchestrator and its orphaned `analysis/` directory.
- **Scanner left stale graph state behind**: rescans only skipped unchanged files; they never removed nodes and edges for code that had been deleted. The scanner now records the node/edge slice each file produces, deletes the previous slice before inserting the new one, and sweeps files that disappeared from disk. Each file's update runs in a SQLite transaction. `ScanResult` gains `dir` and `removed`.
- **Import resolution guessed `.ts`** without checking the filesystem, producing wrong graph edges for JS/JSX/TSX and directory-index imports. `resolveImportSource` now verifies the target exists across `.ts/.tsx/.js/.jsx` and `index.*` before creating an edge, and creates no edge when the import can't be resolved.
- **Prompt base directory was dead code**: the scanned directory was never recorded, so `prompt_build` often read against an empty base path. The scanner now reports `dir` in `scanner:complete` and prompt stores it.
- **Resource template matching** left literal regex characters (`.`, `+`, `(`, …) active. `registerResourceTemplate` escapes literal segments and captures only `{var}` placeholders.
- **Failed module loads** left already-initialized modules running. `loadModules` now closes them in reverse order before rethrowing.

### Changed
- **TypeScript is a real gate now**: added Bun types to `tsconfig.json`, a `.d.ts` contract for the JS analyzer AST (`parser`/`ast`), and a `typecheck` script. `tsc --noEmit` runs clean instead of failing on missing globals and `never`-typed parser output.
- **Beacon indexes incrementally**: mutations queue per-document upserts and deletes that flush before the next search, instead of clearing and rebuilding the whole FTS corpus on any change. Edge events no longer dirty the index. `beacon_reindex` still does a full rebuild for repair.
- **Graph traversal** uses head-pointer queues instead of `Array.shift()` in `patterns.traverse`/`shortestPath` and `stats.compute`; `prompt.collectRelated` builds an adjacency index once per call instead of scanning the full edge list per frontier node.
- **Bun-native replacements**: ESM `node:fs` import for the watcher (was `require("fs")`), `Uint8Array#toBase64()` (was `Buffer.from(...).toString("base64")`), `Bun.env` in the example resource template.
- **Docs**: module import examples use the public `tiny-mcp-server/modules/*` subpath instead of the private `src/...` path that the `exports` map blocks.

### Added
- `PatternsAPI` gains `deleteNode` and `deleteEdge`, emitting `patterns:nodeRemoved` / `patterns:edgeRemoved`.
- Tests: scanner incremental cleanup and import resolution (5), incremental beacon indexing (4), resource-template escaping and module-load rollback (3).

## 0.4.2

### Changed
- **README**: Rewritten intro to clarify that tiny-mcp-server is a toolkit for building MCP servers, not a server itself. Module Framework section now highlights pick-and-choose composability and includes a custom module example showing how to extend built-in modules like Recall and Patterns.
- **package.json**: Updated description to match.
- **HOWTO-AI-AGENTS**: Minor wording update for consistency.

## 0.4.1

### Fixed
- **Package distribution**: Added missing `src/analyzer/lexer.js` and `src/analyzer/tokens.js` to `files` array in `package.json`. The parser depends on both but they were excluded from the published package.

## 0.4.0

### Added
- **Scanner module** (`src/modules/scanner.ts`): Directory scanner with JS/TS parser. Extracts functions, classes, interfaces, type aliases, imports, calls, side effects, and complexity metrics. Populates the Patterns graph automatically. Incremental via file hash caching. Watch mode for auto-rescan on file changes.
- **Query module** (`src/modules/query.ts`): Predicate-based query engine combining graph traversal and text search. Supports type, where (metadata predicates with gt/lt/gte/lte/exists/contains/in), near (proximity), relationship, search, sort, and limit filters.
- **Export module** (`src/modules/export.ts`): Graph export as DOT (Graphviz) or JSON with node type→shape mapping. Supports filtering by type, relationship, and proximity.
- **Diff module** (`src/modules/diff.ts`): Snapshot-based graph comparison. Detects added, removed, and changed nodes/edges via JSON fingerprinting. Snapshots stored in Recall.
- **Stats module** (`src/modules/stats.ts`): Aggregate metrics — complexity stats, most-connected nodes (top 10 by degree), hotspot detection (complexity × connectivity), and max dependency depth via BFS.
- **Refactor module** (`src/modules/refactor.ts`): Find all references to a symbol across the codebase graph. Traces definitions, call sites, imports, extends, and implements edges. Rename impact preview shows all affected files and nodes.
- **Prompt Builder module** (`src/modules/prompt.ts`): Extracts minimal LLM context from the graph. Walks from a focus symbol outward collecting parent imports, dependencies, types, and callers. Reads actual source lines from disk. Token budgeting via `maxTokens` (default 4000). Sections toggleable and grouped by file.
- **Barrel export** (`src/index.ts`): Re-exports all modules and types from a single entry point.
- **Error boundaries**: Tool execution catches errors with stack traces. Event emit wrapped in try/catch so one bad handler won't break others. Optional `toolTimeout` for tool execution deadlines via `Promise.race`.
- **Watch mode**: `scanner_watch` / `scanner_unwatch` tools. Debounced file system watching with `fs.watch` recursive. `close()` lifecycle cleans up watcher.
- **Example modules server** (`examples/modules.ts`): Complete working example loading all 10 modules.
- **New tests**: Parser tests (20), scanner enrichment tests (10), query tests (17), export tests (14), diff tests (9), stats tests (9), refactor tests (9), prompt tests (15).

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
