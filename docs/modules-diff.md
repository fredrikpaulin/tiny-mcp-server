# Diff Module

Compares the current Patterns graph against a stored snapshot and reports what was added, removed or changed. Snapshots are named, so you can hold several reference points at once — one before a refactor, one per release.

This is graph diffing, not git diffing. It answers "what changed in the structure I have indexed" and needs no repository.

## Setup

```ts
import { loadModules, serve } from "tiny-mcp-server";
import recall from "tiny-mcp-server/modules/recall";
import patterns from "tiny-mcp-server/modules/patterns";
import graphExport from "tiny-mcp-server/modules/export";
import diff from "tiny-mcp-server/modules/diff";

await loadModules([
  recall({ dbPath: "./context.db" }),
  patterns(),
  graphExport(),
  diff(),
]);
serve();
```

**Depends on:** `recall`, `patterns`, `export`

Export is a dependency because Diff snapshots the graph through `export.toJSON()` rather than reading Patterns directly, so both see exactly the same shape.

## Tools

### `graph_snapshot`

Record the current graph state under a name.

```json
{ "name": "before-refactor" }
// → { "ok": true, "name": "before-refactor", "nodes": 3003, "edges": 5694, "timestamp": 1786455600000 }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | no | Snapshot name (default `"latest"`) |

Taking a snapshot under an existing name replaces it.

### `graph_diff`

Compare the current graph against a stored snapshot.

```json
{ "name": "before-refactor" }
```

Returns:
```json
{
  "nodes": {
    "added": ["utils/parse.ts:parseHeader"],
    "removed": ["utils/old.ts:legacyParse"],
    "changed": ["server.ts:handleRequest"]
  },
  "edges": {
    "added": ["server.ts:handleRequest -[calls]-> utils/parse.ts:parseHeader"],
    "removed": ["server.ts:handleRequest -[calls]-> utils/old.ts:legacyParse"]
  },
  "summary": {
    "nodesAdded": 1, "nodesRemoved": 1, "nodesChanged": 1,
    "edgesAdded": 1, "edgesRemoved": 1
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | no | Snapshot to compare against (default `"latest"`) |

If no snapshot exists under that name, everything currently in the graph is reported as added. That makes a first run informative rather than an error.

### `graph_snapshots`

List stored snapshot names.

```json
{}
// → { "snapshots": ["latest", "before-refactor", "v0.4.0"] }
// most recently written first
```

## What counts as changed

Nodes are matched by `id`. A node present in both is **changed** when its fingerprint differs, where the fingerprint is `type`, `name` and `metadata` serialised together. So a function whose complexity moved from 4 to 9, or which gained a `returnType`, shows as changed.

Two things deliberately excluded from the fingerprint:

- **`boost`** — a user-curated ranking value, not a property of the code. Re-boosting a node isn't a change to the graph.
- **Edge metadata** — edges are compared by identity only, as `from -[relationship]-> to`. An edge whose metadata changed reads as unchanged.

The metadata comparison serialises the parsed object, so a change in key order alone reports the node as changed. In practice metadata is written by the scanner in a fixed order, so this only bites if you write metadata by hand.

Edges have no stable id, so they are keyed by that triple. Changing a relationship type therefore shows as one edge removed and one added, which is usually what you want to see.

## API for Other Modules

Diff exposes `ctx.diff`:

| Method | Signature | Description |
|--------|-----------|-------------|
| `snapshot` | `(name?: string) => Snapshot` | Record and return the current state |
| `compare` | `(name?: string) => DiffResult` | Diff current state against a snapshot |
| `listSnapshots` | `() => string[]` | Stored snapshot names |

```ts
ctx.diff.snapshot("pre-scan");
await ctx.scanner.scan("./src");
const changes = ctx.diff.compare("pre-scan");
if (changes.summary.nodesRemoved > 0) {
  // something disappeared from the codebase
}
```

## Storage

Snapshots live in Recall's internal store, under `diff:snap:{name}`. That means they do not appear in `recall_query` results and are not indexed by Beacon — they are module bookkeeping, not the consumer's data. See [Recall](modules-recall.md#module-internal-state).

A snapshot holds every node and edge with metadata, so it is roughly the size of a `graph_export` JSON payload — for a graph of a few thousand nodes, megabytes rather than kilobytes. Keep a handful of named snapshots, not one per scan.
