# Scanner Module

Auto-populates the Patterns graph by walking a directory and parsing JS/TS files. Extracts files, functions, classes, interfaces, type aliases, variables, import relationships, call edges, side effects, and class methods. Incremental — tracks file hashes to skip unchanged files on rescan.

## Setup

```ts
import { loadModules, serve } from "tiny-mcp-server";
import recall from "tiny-mcp-server/src/modules/recall";
import patterns from "tiny-mcp-server/src/modules/patterns";
import scanner from "tiny-mcp-server/src/modules/scanner";

await loadModules([
  recall({ dbPath: "./context.db" }),
  patterns(),
  scanner({ ignore: ["vendor", "generated"] }),
]);
serve();
```

**Depends on:** `recall`, `patterns`

### Config

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ignore` | `string[]` | `[]` | Extra directory names to skip during scanning |

## Tools

### `scanner_scan`

Scan a directory to populate the context graph.

```json
{ "dir": "/path/to/project/src", "force": false }
```

Returns:
```json
{
  "files": 13,
  "parsed": 13,
  "skipped": 0,
  "errors": [],
  "nodes": 342,
  "edges": 2073,
  "interfaces": 8,
  "typeAliases": 5,
  "timing_ms": 47.11
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `dir` | `string` | yes | Directory path to scan |
| `force` | `boolean` | no | Force rescan of all files, ignoring cache |

## What Gets Extracted

### Node Types

| Type | ID Format | Metadata |
|------|-----------|----------|
| `file` | relative path (e.g. `src/mcp.ts`) | functions, classes, imports, exports, interfaces, typeAliases counts |
| `function` | `{path}:{name}` (e.g. `src/mcp.ts:handleRequest`) | params, line, exported, async, complexity, cognitive, maxNesting, loopCount, lineCount, generator, arrow, returnType, decorators |
| `function` (method) | `{path}:{Class}.{method}` (e.g. `src/mcp.ts:AppServer.start`) | params, line, method, static, complexity, cognitive |
| `class` | `{path}:{name}` (e.g. `src/mcp.ts:ToolError`) | line, exported, extends, implements, decorators |
| `variable` | `{path}:{name}` (exported only) | line, exported, typeAnnotation |
| `interface` | `{path}:{name}` (e.g. `src/mcp.ts:ModuleContext`) | line, extends |
| `type` | `{path}:{name}` (e.g. `src/mcp.ts:Direction`) | line, definition |

### Edge Types

| Relationship | From | To | Metadata | Description |
|-------------|------|-----|----------|-------------|
| `imports` | file | file | specifiers, typeOnly | File A imports from file B |
| `dynamic_imports` | file | file | — | File A dynamically imports file B |
| `defines` | file | function/class/interface/type | — | File defines a symbol |
| `exports` | file | function/class/variable | — | File exports a symbol |
| `extends` | class/interface | class/interface (symbolic) | — | Inheritance |
| `implements` | class | interface (symbolic) | — | Class implements interface |
| `has_method` | class | function (method) | — | Class contains method |
| `calls` | function | function | fullChain, isNew, isAwait | Function A calls function B (same-file + cross-file via imports) |
| `has_effect` | function | `effect:{type}` | type, apiCall | Function has side effect |

### Side Effect Types

Side effect nodes use the ID format `effect:{type}` where type is one of: `db_read`, `db_write`, `file_read`, `file_write`, `network`, `console`, `process`, `dom`, `storage`.

### Cross-File Call Resolution

The scanner resolves calls across files by matching the callee name against imported names. For example, if `server.ts` imports `validate` from `utils/validate.ts`, a call to `validate()` inside a function in `server.ts` creates an edge to `utils/validate.ts:validate`.

## Incremental Scanning

Scanner stores a hash of each file's contents in Recall (namespaced under `scanner:hash:{path}`). On subsequent scans, files with matching hashes are skipped. Use `force: true` to override.

## File Discovery

Scanner uses `Bun.Glob` to find `.ts`, `.tsx`, `.js`, `.jsx` files. These directories are always skipped: `node_modules`, `dist`, `build`, `.next`, `coverage`, `.git`, `__pycache__`, `.turbo`, `.cache`, `.output`, `vendor`. Additional directories can be excluded via the `ignore` config option. Files larger than 500KB are skipped.

## Parser

The scanner uses a hand-written recursive descent parser (ported from skeleton-ts) that lives in `src/analyzer/`. It handles full JS/TS/JSX/TSX syntax including generics, decorators, optional chaining, and type annotations. The parser extracts complexity metrics (cyclomatic, cognitive, nesting depth, loop count) per function.

## Events

| Event | Payload | When |
|-------|---------|------|
| `scanner:fileScanned` | `{ file, nodes, edges }` | After each file is processed |
| `scanner:complete` | Full `ScanResult` object | After scan finishes |

## API for Other Modules

Scanner exposes `ctx.scanner`:

| Method | Signature | Description |
|--------|-----------|-------------|
| `scan` | `(dir, opts?) => Promise<ScanResult>` | Scan a directory, returns stats |

## Example: Scan and Search

```ts
// After loading all modules including scanner and beacon:
await scanner.scan("./src");
// Now beacon can search the entire codebase graph
const results = beacon.search("handleRequest");
// And patterns can traverse dependencies
const deps = patterns.traverse("src/mcp.ts", { direction: "outgoing", relationship: "imports" });
// Query for high-complexity functions
const fns = patterns.query({ type: "function" });
const complex = fns.filter(f => f.metadata?.complexity > 10);
// Find all network side effects
const effects = patterns.query({ relationship: "has_effect" });
const network = effects.filter(e => e.to === "effect:network");
```
