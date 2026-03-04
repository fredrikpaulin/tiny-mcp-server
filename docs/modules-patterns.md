# Patterns Module

Context graph builder for tiny-mcp-server. Creates a queryable graph of nodes (files, functions, classes, etc.), edges (imports, extends, calls), and notes. Persists everything via the Recall module.

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

Stored in Recall with key conventions:

| Key Pattern | Contains |
|-------------|----------|
| `patterns:node:{id}` | `{ id, type, name, metadata }` |
| `patterns:edge:{from}:{to}:{relationship}` | `{ from, to, relationship, metadata }` |
| `patterns:note:{entity}` | `[{ text, timestamp }]` |

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

**No filters** — returns all nodes:
```json
{}
```

### `patterns_add_note`

Attach a note to any entity.

```json
{ "entity": "mcp.ts", "note": "Core server implementation, keep minimal" }
```

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

## Use Cases

An agent working on a project can build the graph incrementally:

1. Add nodes for key files, functions, and classes
2. Add edges for imports, inheritance, and call relationships
3. Add notes with observations, TODOs, and context
4. Query by node ID for full context before making changes
5. Query by type to find all functions, files, etc.
