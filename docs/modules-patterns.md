# Patterns Module

Context graph builder for tiny-mcp-server. Creates a queryable graph of nodes (files, functions, classes, etc.), edges (imports, extends, calls), and notes. Supports graph traversal with BFS/DFS, shortest path, and neighbor queries. Persists everything via the Recall module.

## Setup

```ts
import { loadModules, serve } from "tiny-mcp-server";
import recall from "tiny-mcp-server/src/modules/recall";
import patterns from "tiny-mcp-server/src/modules/patterns";

await loadModules([recall({ dbPath: "./context.db" }), patterns()]);
serve();
```

**Depends on:** `recall`

## Graph Model

Stored in dedicated SQLite tables (shared database via Recall's `db()` handle) with indexed columns for fast lookups:

| Table | Columns | Indexes |
|-------|---------|---------|
| `patterns_nodes` | `id` (PK), `type`, `name`, `boost` (REAL), `metadata` (JSON) | `type` |
| `patterns_edges` | `id` (auto), `src`, `dst`, `relationship`, `metadata` (JSON), UNIQUE(src,dst,relationship) | `src`, `dst`, `relationship` |
| `patterns_notes` | `id` (auto), `entity`, `text`, `timestamp` | `entity` |

## Tools

### `patterns_add_node`

Add a node to the graph.

```json
{ "id": "mcp.ts", "type": "file", "name": "mcp.ts", "metadata": { "lines": 378 } }
```

### `patterns_add_edge`

Add a relationship between two nodes.

```json
{ "from": "server.ts", "to": "mcp.ts", "relationship": "imports" }
```

### `patterns_query`

Query the graph. Supports three modes:

**By node ID** — returns full context (node + edges + notes):
```json
{ "nodeId": "mcp.ts" }
```

**By type** — returns matching nodes:
```json
{ "type": "function" }
```

**By relationship** — returns matching edges:
```json
{ "relationship": "imports" }
```

### `patterns_add_note`

Attach a note to any entity.

```json
{ "entity": "mcp.ts", "note": "Core server implementation, keep minimal" }
```

### `patterns_neighbors`

Get directly connected nodes, filtered by direction and relationship type.

```json
{ "id": "server", "direction": "outgoing", "relationship": "calls" }
```

Returns:
```json
{ "nodes": [{ "id": "handler", "type": "function", "name": "handleRequest" }], "count": 1 }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | yes | Node ID to get neighbors of |
| `direction` | `string` | no | `"outgoing"`, `"incoming"`, or `"both"` (default: both) |
| `relationship` | `string` | no | Filter by relationship type |

### `patterns_traverse`

Walk the graph from a starting node. Returns all reachable nodes and edges within the depth limit.

```json
{ "startId": "main", "direction": "outgoing", "maxDepth": 5, "mode": "bfs" }
```

Returns:
```json
{
  "nodes": [{ "id": "main", ... }, { "id": "server", ... }, ...],
  "edges": [{ "from": "main", "to": "server", "relationship": "calls" }, ...],
  "depth": 3
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `startId` | `string` | yes | Node to start from |
| `direction` | `string` | no | `"outgoing"` (default), `"incoming"`, or `"both"` |
| `relationship` | `string` | no | Only follow edges of this type |
| `maxDepth` | `integer` | no | Max hops (default: 10, max: 50) |
| `mode` | `string` | no | `"bfs"` (default) or `"dfs"` |

### `patterns_shortest_path`

Find the shortest path between two nodes via BFS.

```json
{ "fromId": "main", "toId": "database" }
```

Returns the ordered sequence of nodes and edges, or `length: -1` if no path exists:
```json
{
  "nodes": [{ "id": "main", ... }, { "id": "server", ... }, { "id": "database", ... }],
  "edges": [{ "from": "main", "to": "server", ... }, { "from": "server", "to": "database", ... }],
  "length": 2
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `fromId` | `string` | yes | Starting node ID |
| `toId` | `string` | yes | Target node ID |
| `direction` | `string` | no | `"outgoing"`, `"incoming"`, or `"both"` (default: both) |
| `relationship` | `string` | no | Only follow edges of this type |

## Boost

Nodes support a `boost` value (default 0) used by the Beacon search module to promote important nodes in search results. Set via `patterns.setBoost(id, boost)`.

## API for Other Modules

Patterns exposes `ctx.patterns`:

| Method | Description |
|--------|-------------|
| `addNode(id, type, name, metadata?)` | Add graph node |
| `addEdge(from, to, relationship, metadata?)` | Add edge |
| `getNode(id)` | Get single node |
| `getEdges(nodeId)` | Get all edges for a node |
| `query({ type?, relationship?, nodeId? })` | Flexible query |
| `addNote(entity, note)` | Attach note |
| `getNotes(entity)` | Get notes for entity |
| `setBoost(id, boost)` | Set node boost for search ranking |
| `neighbors(id, opts?)` | Get directly connected nodes |
| `traverse(startId, opts?)` | BFS/DFS graph walk |
| `shortestPath(fromId, toId, opts?)` | Shortest path between nodes |

## Use Cases

An agent working on a project can build the graph incrementally:

1. Add nodes for key files, functions, and classes
2. Add edges for imports, inheritance, and call relationships
3. Add notes with observations, TODOs, and context
4. Query by node ID for full context before making changes
5. Use `traverse` to find all dependencies of a function
6. Use `shortestPath` to understand how two modules are connected
7. Use `neighbors` with direction filters to find callers vs callees
