# Roadmap

## Current State (v0.3.0)

### Module Framework
~55 lines added to `mcp.ts`. Provides `loadModules()` with topological dependency sorting, a shared `ModuleContext` for inter-module communication, and `closeModules()` for cleanup. The contract is minimal: a factory function returning `{ name, depends?, init, close? }`. No classes, no DI container, no lifecycle ceremonies.

### Recall
SQLite persistence layer via `bun:sqlite` with prepared statements. Exposes a simple key-value API — `set`, `get`, `query` (SQL LIKE patterns), `delete`. Everything else stores data through it. Deliberately simple flat key-value store with JSON serialization.

### Patterns
Context graph with nodes (files, functions, classes), edges (imports, extends, calls), and notes. All persisted via Recall using key conventions like `patterns:node:{id}` and `patterns:edge:{from}:{to}:{rel}`. Queryable by node ID (full context), by type, or by relationship. Holds the map of a project, but currently requires manual population.

### Beacon
Search layer that queries across Recall keys, Patterns nodes, and notes in a single call. Scores results by match quality and returns them sorted. Functional but basic — string matching with a simple scoring heuristic.

---

## Improvements to Existing Modules

### Recall — Namespacing and TTL
Every module currently shares one flat keyspace, relying on key prefixes (`patterns:node:*`) to avoid collisions. A namespace-per-module approach or a `recall.namespace("patterns")` helper would make this more robust. TTL-based expiry would let modules store transient context (like "files changed in last session") without manual cleanup.

### Patterns — Indexed Storage and Graph Traversal
Two gaps to address:

**Indexed storage.** Every query currently scans all keys via SQL LIKE. For a small project that's fine, but for a large codebase with thousands of nodes, moving from Recall's key-value model to actual SQLite tables with proper indexes (a `nodes` table, an `edges` table with indexed `from`/`to`/`relationship` columns) would make queries much faster.

**Graph traversal.** There's currently no way to ask "what does this file transitively depend on?" or "find all paths between A and B." Adding depth-limited BFS/DFS traversal methods would make the graph useful for understanding architecture.

### Beacon — Better Scoring and Relevance
The current substring matching misses things like searching "srv" when the node is called "serve." Trigram matching or Levenshtein distance would help. Weighting by recency (using Recall's `updated_at`) would surface recently-relevant context first.

---

## New Modules

### Automated Graph Building (patterns-scanner)
This is the big one. Currently Patterns requires manual `patterns_add_node` calls — an agent has to explicitly build the graph. A scanner module that walks a directory, identifies files, and extracts structure would automate this entirely. For TypeScript/JavaScript that means parsing imports, exports, function signatures, class declarations, and their relationships.

Key features:
- **Incremental updates** — store file hashes in Recall, compare on scan, only reprocess what changed
- **Language-agnostic design** — pluggable parsers for TypeScript, Python, Go, Rust, etc. Each parser produces the same node/edge format; the graph doesn't care what language it came from

This is a larger project and likely its own module that depends on Patterns.

### Context Window
Track what an agent has looked at in a session — which files were read, which tools were called, what queries were made. This gives you a "working memory" that Beacon can search, so the agent can ask "what was I looking at earlier?" without re-scanning.

### Diff
Git integration — track what changed between commits, map changes to graph nodes, and answer "what parts of the graph are affected by recent changes?"

### Prompt Builder
Use the graph to build minimal context for LLM calls. Instead of sending an entire file, extract just the relevant subgraph (a function, its dependencies, and its callers) and format it as a compact prompt. This is the real token-saving payoff — giving an agent exactly the context it needs and nothing more.
