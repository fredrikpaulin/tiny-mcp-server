# Module Framework Implementation Plan

## Overview

Add a composable module framework to tiny-mcp-server. A module is a plain object with metadata that registers tools/resources and can expose APIs to other modules via a shared context. A thin `loadModules()` function handles dependency resolution, config validation, and ordered initialization.

## Design Decisions

- **Modules live in `src/modules/`** inside the package
- **Config via constructor arguments** — each module is a factory function that accepts config and returns a `ModuleMetadata` object
- **Patterns module focuses on graph structure** — filesystem scanning is out of scope, stubbed for later
- **Async `loadModules()`** — module init can involve database setup, file I/O
- **Topological sort via DFS** — simple O(V+E), detects circular deps, ~20 lines
- **Plain objects, not classes** — zero overhead, easy to mock, matches project style
- **Reuses existing `validateInput()`** for config validation
- **`_reset()` extended** to clear module state automatically

## Module Contract

```ts
interface ModuleMetadata {
  name: string
  depends?: string[]
  schema?: Record<string, unknown>  // JSON Schema for config validation
  init: (ctx: ModuleContext) => void | Promise<void>
  close?: () => void | Promise<void>
}
```

Factory pattern (config via constructor):

```ts
// modules/recall.ts
export default function recall(config = {}) {
  let db
  return {
    name: "recall",
    schema: { type: "object", properties: { dbPath: { type: "string" } } },
    init(ctx) {
      db = new Database(config.dbPath || ":memory:")
      ctx.recall = { get, set, query, delete: del }
      ctx.registerTool("recall_save", ...)
    },
    close() { db.close() }
  }
}

// server.ts
import recall from "./modules/recall"
import patterns from "./modules/patterns"
await loadModules([recall({ dbPath: "data.db" }), patterns()])
serve()
```

## Module Context

The `ctx` object passed to every module's `init()`:

```ts
interface ModuleContext {
  registerTool: typeof registerTool
  registerResource: typeof registerResource
  registerResourceTemplate: typeof registerResourceTemplate
  validateInput: typeof validateInput
  ToolError: typeof ToolError
  sample: typeof sample
  [key: string]: unknown  // module APIs (ctx.recall, ctx.patterns, etc.)
}
```

---

## Phase 1: Core Framework (~80 lines added to src/mcp.ts)

### 1.1 Add type definitions

Add `ModuleMetadata`, `ModuleContext` interfaces and export them.

### 1.2 Add `toposort()` (private)

DFS-based topological sort. Detects circular dependencies and missing modules.

```ts
function toposort(modules: ModuleMetadata[]): ModuleMetadata[] {
  const indexed = new Map(modules.map(m => [m.name, m]))
  const visited = new Set(), visiting = new Set(), result = []

  function visit(name) {
    if (visited.has(name)) return
    if (visiting.has(name)) throw new Error(`Circular dependency: ${name}`)
    visiting.add(name)
    const mod = indexed.get(name)
    if (!mod) throw new Error(`Missing module: ${name}`)
    for (const dep of mod.depends || []) visit(dep)
    visiting.delete(name)
    visited.add(name)
    result.push(mod)
  }

  for (const mod of modules) visit(mod.name)
  return result
}
```

### 1.3 Add `loadModules(modules[])`

- Topological sort
- Validate each module's config against its schema (if provided) using `validateInput()`
- Build shared `ctx` with core registration functions
- Call `init(ctx)` in dependency order
- Track loaded modules for cleanup

```ts
const loadedModules: ModuleMetadata[] = []

export async function loadModules(modules: ModuleMetadata[]) {
  const sorted = toposort(modules)
  const ctx = { registerTool, registerResource, registerResourceTemplate, validateInput, ToolError, sample }

  for (const mod of sorted) {
    if (mod.schema) {
      const errors = validateInput(mod.schema, mod)  // validate the module's own config
      // Note: config is baked into the module via constructor, schema validates shape
    }
    await mod.init(ctx)
    loadedModules.push(mod)
  }
}
```

### 1.4 Add `closeModules()`

Calls `close()` on each loaded module in reverse order.

```ts
export async function closeModules() {
  for (const mod of loadedModules.reverse()) {
    if (mod.close) await mod.close()
  }
  loadedModules.length = 0
}
```

### 1.5 Update `_reset()`

Add `loadedModules.length = 0` to the existing `_reset()` function.

### 1.6 Update `src/index.ts`

Export new types and functions: `ModuleMetadata`, `ModuleContext`, `loadModules`, `closeModules`.

### Files touched
- `src/mcp.ts` — add ~80 lines (types, toposort, loadModules, closeModules, update _reset)
- `src/index.ts` — add exports

---

## Phase 2: Recall Module (src/modules/recall.ts)

SQLite-based persistence using `bun:sqlite`. Foundation for other modules.

### Config (via constructor)
```ts
recall({ dbPath: ":memory:" })
```

### Database Schema
```sql
CREATE TABLE IF NOT EXISTS recall_data (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)
```

### API exposed on `ctx.recall`
- `set(key, value)` — upsert JSON value
- `get(key)` — retrieve JSON value or null
- `query(pattern)` — LIKE-based key search, returns `[key, value][]`
- `delete(key)` — remove entry

### Tools registered
| Tool | Description | Input |
|------|-------------|-------|
| `recall_save` | Save data to recall store | `{ key: string, value: object }` |
| `recall_get` | Retrieve data by key | `{ key: string }` |
| `recall_query` | Query with SQL LIKE pattern | `{ pattern: string }` |
| `recall_delete` | Delete entry by key | `{ key: string }` |

### Cleanup
`close()` calls `db.close()`.

### Files created
- `src/modules/recall.ts` (~120 lines)

---

## Phase 3: Patterns Module (src/modules/patterns.ts)

Context graph builder. Depends on Recall for persistence. Focuses on graph data structure — no filesystem scanning yet.

### Config (via constructor)
```ts
patterns()  // no config needed for now
```

### Graph Model

Stored in Recall with key conventions:
- `patterns:node:{id}` — node data `{ id, type, name, metadata }`
- `patterns:edge:{from}:{to}` — edge data `{ from, to, relationship, metadata }`
- `patterns:note:{entity}` — notes array `[{ text, timestamp }]`

### API exposed on `ctx.patterns`
- `addNode(id, type, name, metadata?)` — add node to graph
- `addEdge(from, to, relationship, metadata?)` — add edge between nodes
- `getNode(id)` — retrieve node
- `getEdges(nodeId)` — get all edges for a node
- `query(opts)` — query nodes/edges by type or relationship
- `addNote(entity, note)` — attach note to an entity

### Tools registered
| Tool | Description | Input |
|------|-------------|-------|
| `patterns_add_node` | Add node to context graph | `{ id, type, name, metadata? }` |
| `patterns_add_edge` | Add edge between nodes | `{ from, to, relationship, metadata? }` |
| `patterns_query` | Query graph nodes/edges | `{ type?, relationship?, nodeId? }` |
| `patterns_add_note` | Add note to entity | `{ entity, note }` |

### Files created
- `src/modules/patterns.ts` (~130 lines)

---

## Phase 4: Beacon Module (src/modules/beacon.ts)

Fast search across Recall data and Patterns graph. Depends on both Recall and Patterns.

### Config (via constructor)
```ts
beacon({ maxResults: 20 })
```

### API exposed on `ctx.beacon`
- `search(query, opts?)` — search across keys, nodes, notes. Returns scored results.

### Search Strategy
1. Query Recall for keys matching `%query%`
2. Query Patterns for nodes with matching name/type
3. Query Patterns for notes containing the query text
4. Score by relevance (exact match > partial > fuzzy)
5. Merge, deduplicate, return top N

### Tools registered
| Tool | Description | Input |
|------|-------------|-------|
| `beacon_search` | Search across all context | `{ query, maxResults?, types? }` |

### Files created
- `src/modules/beacon.ts` (~100 lines)

---

## Phase 5: Tests

### 5.1 Framework tests — `test/modules.test.ts` (~150 lines)

Tests for the core `loadModules` / `closeModules` machinery:

- Loads single module, tools registered correctly
- Resolves dependencies in topological order (verify init order)
- Throws on circular dependencies
- Throws on missing dependency
- Validates config against module schema
- Passes shared ctx between modules (module B reads ctx.moduleA)
- Calls close hooks in reverse initialization order
- `_reset()` clears module state
- Modules can register tools that are callable via `handleRequest`

### 5.2 Recall tests — `test/recall.module.test.ts` (~120 lines)

- Registers all 4 tools
- Save → Get round-trip
- Get on missing key returns `{ found: false }`
- Query with pattern returns matching entries
- Delete removes entry
- Overwrite existing key updates value
- Close cleans up database

### 5.3 Patterns tests — `test/patterns.module.test.ts` (~120 lines)

- Requires recall (verify dependency works)
- Add node → query retrieves it
- Add edge → getEdges returns it
- Query by type filters correctly
- Query by relationship filters correctly
- Add note → query includes notes
- Multiple notes on same entity accumulate

### 5.4 Beacon tests — `test/beacon.module.test.ts` (~80 lines)

- Requires recall + patterns (verify chain dependency)
- Search finds recall keys
- Search finds pattern nodes
- Search finds notes
- Results are scored and sorted
- maxResults limits output
- Empty query returns empty results

### 5.5 Verify existing tests still pass

Run full `bun test` to confirm no regressions.

### Files created
- `test/modules.test.ts`
- `test/recall.module.test.ts`
- `test/patterns.module.test.ts`
- `test/beacon.module.test.ts`

---

## Phase 6: Documentation

### 6.1 `docs/modules.md` — Framework guide

- Module definition (the contract)
- Factory pattern with constructor config
- Loading modules with `loadModules()`
- Module context and inter-module APIs
- Dependency resolution
- Cleanup with `closeModules()`
- Error handling (circular, missing, validation, init failures)
- Testing modules (patterns with `_reset()` and `handleRequest()`)

### 6.2 `docs/modules-recall.md` — Recall module guide

- Purpose, tools, config, usage example

### 6.3 `docs/modules-patterns.md` — Patterns module guide

- Purpose, graph model, tools, config, usage example

### 6.4 `docs/modules-beacon.md` — Beacon module guide

- Purpose, search strategy, tools, config, usage example

### Files created
- `docs/modules.md`
- `docs/modules-recall.md`
- `docs/modules-patterns.md`
- `docs/modules-beacon.md`

---

## Phase 7: Example Server & Polish

### 7.1 Create `examples/with-modules.ts`

Composite server loading all three modules with config.

### 7.2 Update `README.md`

Add "Module Framework" section with quick example and link to docs/modules.md.

### 7.3 Update `package.json`

Add module files to the `files` array for npm publishing.

### 7.4 Final test run

Run `bun test` — all existing + new tests must pass.

### Files created/modified
- `examples/with-modules.ts` (new)
- `README.md` (modified)
- `package.json` (modified)

---

## File Structure (final)

```
tiny-mcp-server/
├── src/
│   ├── mcp.ts                    ← modified (+~80 lines)
│   ├── index.ts                  ← modified (add exports)
│   └── modules/
│       ├── recall.ts             ← new (~120 lines)
│       ├── patterns.ts           ← new (~130 lines)
│       └── beacon.ts             ← new (~100 lines)
├── test/
│   ├── mcp.test.ts               ← unchanged
│   ├── integration.test.ts       ← unchanged
│   ├── modules.test.ts           ← new (~150 lines)
│   ├── recall.module.test.ts     ← new (~120 lines)
│   ├── patterns.module.test.ts   ← new (~120 lines)
│   └── beacon.module.test.ts     ← new (~80 lines)
├── docs/
│   ├── modules.md                ← new
│   ├── modules-recall.md         ← new
│   ├── modules-patterns.md       ← new
│   └── modules-beacon.md         ← new
├── examples/
│   ├── basic.ts                  ← unchanged
│   └── with-modules.ts           ← new
├── package.json                  ← modified (files array)
└── README.md                     ← modified (add section)
```

## Estimated Additions

- ~80 lines to `src/mcp.ts` (core framework)
- ~350 lines across 3 modules
- ~470 lines across 4 test files
- ~4 documentation files
- ~1 example server

Total: ~900 lines of new code + docs
