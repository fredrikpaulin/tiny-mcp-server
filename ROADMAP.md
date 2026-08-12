# Roadmap

## Current state (v0.4.6)

Ten modules, all optional and independently loadable. The framework is ~55 lines in
`mcp.ts`: `loadModules()` with topological dependency sorting, a shared
`ModuleContext`, and `closeModules()` for cleanup. A module is a factory returning
`{ name, depends?, init, close? }` — no classes, no container, no lifecycle ceremony.

| Module | What it does |
|--------|--------------|
| Recall | SQLite persistence. `recall_data` for the consumer's key-value store, `recall_internal` for module bookkeeping. WAL, prepared statements, `namespace()` and `internal()` views. |
| Patterns | Context graph in its own indexed tables — `patterns_nodes`, `patterns_edges`, `patterns_notes`. BFS/DFS traversal, shortest path, neighbours, node boost. |
| Beacon | FTS5 search across graph nodes, notes and recall entries. BM25 with a trigram index for substring matches, boost applied at scoring, incremental per-document indexing. |
| Scanner | Walks a directory, parses JS/TS, populates the graph. Incremental by content hash, tracks each file's node/edge slice so deletions clean up after themselves. Watch mode. |
| Query | Predicate filtering over the graph — type, metadata operators, proximity, relationship, text search, sort, limit. |
| Export | Graph as DOT or JSON, filterable. |
| Diff | Snapshot-based graph comparison. Detects added, removed and changed nodes and edges by fingerprint. |
| Stats | Aggregate metrics — complexity, most-connected nodes, hotspots, dependency depth. |
| Refactor | Find all references to a symbol; preview rename impact. |
| Prompt | Extracts a minimal subgraph around a focus symbol and reads the relevant source lines into a compact prompt. |

The analyzer under `src/analyzer/` is a hand-written lexer and recursive-descent
parser for JS/TS. No dependencies.

## What shipped since this file last described the plan

Most of what the 0.3.0 roadmap listed as future work is now in. Recorded here because
the gap between plan and outcome is the interesting part:

- **Recall namespacing** — shipped in 0.3.0 as `namespace(prefix)`, and 0.4.4 added `internal(prefix)` for module bookkeeping. The original note proposed namespacing to avoid key collisions; the sharper reason turned out to be that bookkeeping in the shared keyspace was being indexed as searchable content.
- **Patterns indexed storage** — shipped in 0.3.0. The graph never lived in Recall's keyspace in any released version, so the old "Current State" description of `patterns:node:{id}` keys was wrong when it was written.
- **Graph traversal** — shipped in 0.4.0: `traverse` (BFS/DFS, depth-limited), `shortestPath`, `neighbors`.
- **Beacon scoring** — shipped in 0.4.0. The plan floated trigram matching or Levenshtein; the answer was FTS5 with BM25 plus a second trigram-tokenized index consulted only when the word index returns few hits.
- **Scanner** — shipped in 0.4.0, roughly as described, including incremental hashing. Still JS/TS only.
- **Diff** — shipped in 0.4.0, but not as planned. The roadmap wanted git integration; what exists is snapshot-based graph comparison, which answers "what changed in the graph" without needing a repository at all. Git integration is still open.
- **Prompt Builder** — shipped in 0.4.0 as described.

## Open

### Recall — TTL
Nothing expires. TTL-based expiry would let a module store genuinely transient
context — "files changed this session" — without hand-rolling cleanup.

### Beacon — recency weighting
`recall_data` carries `updated_at` and scoring ignores it. Weighting recent entries
would surface currently-relevant context ahead of stale matches. Worth measuring
against BM25 alone before committing to it.

### Scanner — languages beyond JS/TS
The graph format is already language-agnostic: nodes, edges, metadata. What's missing
is a parser boundary. A pluggable-parser interface, with each parser producing the
same slice shape, would let Python or Go in without the graph caring.

### Scanner — re-entrancy
Since 0.4.6 the server handles requests concurrently, so two `scanner_scan` calls on
the same directory can interleave. Each file's update is a synchronous transaction so
nothing tears, but the hash and slice cache can end up inconsistent. A per-directory
guard is the likely fix.

### Context Window
Track what an agent looked at in a session — files read, tools called, queries made —
as a searchable working memory, so it can ask "what was I looking at earlier?" without
rescanning. Not started.

### Protocol conformance for progress
Streaming uses a bespoke `notifications/tools/progress` with the request id in
`params.id`. The MCP spec uses `notifications/progress` with a `progressToken` taken
from the request's `_meta`. Aligning is a wire-format change and wants doing
deliberately rather than alongside a bug fix.

### Performance work from the 2026-08-11 audit
Four tickets remain in `project/tickets/backlog/`, all measured and none urgent —
duplicate import resolution (007), reading every file to hash it on rescan (008),
loading the whole edge table for a subgraph walk (009), and hydrating search results
before slicing them (010). Tickets 008 and 010 have small enough headroom after 0.4.4
that they may not be worth the change; the tickets say so.
