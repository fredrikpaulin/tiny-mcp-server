# Export Module

Exports the Patterns context graph as DOT (Graphviz) or JSON. Supports filtering by node type, edge relationship, and proximity to a node — useful for visualization, debugging, and feeding into external analysis tools.

## Setup

```ts
import { loadModules, serve } from "tiny-mcp-server";
import recall from "tiny-mcp-server/src/modules/recall";
import patterns from "tiny-mcp-server/src/modules/patterns";
import graphExport from "tiny-mcp-server/src/modules/export";

await loadModules([
  recall({ dbPath: "./context.db" }),
  patterns(),
  graphExport(),
]);
serve();
```

**Depends on:** `patterns`

## Tools

### `graph_export`

Export the graph in DOT or JSON format.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `format` | `"dot"` or `"json"` | yes | Output format |
| `type` | `string` | no | Filter to node type (function, class, file, etc.) |
| `relationship` | `string` | no | Filter to edge type (calls, imports, defines, etc.) |
| `near` | `object` | no | Subgraph around a node: `{ node, maxDepth?, direction? }` |
| `includeMetadata` | `boolean` | no | Include metadata (default: false for DOT, true for JSON) |

### DOT Output

```json
{ "format": "dot", "output": "digraph G { ... }" }
```

Node shapes by type:

| Node Type | Shape |
|-----------|-------|
| file | folder |
| function | ellipse |
| class | component |
| interface | diamond |
| type | note |
| variable | box |
| effect:* | octagon |

Pipe to Graphviz: `echo "$DOT" | dot -Tsvg -o graph.svg`

### JSON Output

```json
{
  "format": "json",
  "nodes": [
    { "id": "server.ts", "type": "file", "name": "server.ts", "metadata": { ... } }
  ],
  "edges": [
    { "from": "server.ts", "to": "server.ts:handleRequest", "relationship": "defines" }
  ]
}
```

## Filter Examples

Export only the call graph:
```json
{ "format": "dot", "relationship": "calls" }
```

Export functions near a specific file:
```json
{ "format": "json", "type": "function", "near": { "node": "server.ts", "maxDepth": 2 } }
```

Export class hierarchy:
```json
{ "format": "dot", "relationship": "extends" }
```

Export with metadata annotations:
```json
{ "format": "dot", "type": "function", "includeMetadata": true }
```

## API for Other Modules

Export exposes `ctx.export`:

| Method | Signature | Description |
|--------|-----------|-------------|
| `toDot` | `(opts?) => string` | Generate DOT string |
| `toJSON` | `(opts?) => { nodes, edges }` | Generate JSON object |

Both methods accept the same filter options (type, relationship, near, includeMetadata).
