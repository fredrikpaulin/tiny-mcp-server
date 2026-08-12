# Refactor Module

Finds every reference to a symbol across the graph, and previews which files a rename would touch. Works from graph edges rather than text search, so a call site is found because the scanner recorded a `calls` edge, not because a string matched.

## Setup

```ts
import { loadModules, serve } from "tiny-mcp-server";
import recall from "tiny-mcp-server/modules/recall";
import patterns from "tiny-mcp-server/modules/patterns";
import refactor from "tiny-mcp-server/modules/refactor";

await loadModules([
  recall({ dbPath: "./context.db" }),
  patterns(),
  refactor(),
]);
serve();
```

**Depends on:** `patterns`

Needs a populated graph — see [Scanner](modules-scanner.md).

## Tools

### `refactor_refs`

Find the definition and all references for a symbol.

```json
{ "symbol": "validate" }
```

Accepts either a bare name or a full node id (`utils/validate.ts:validate`). A bare name is resolved by exact match on node `name`; if several nodes share a name, the first found wins, so prefer the full id when it matters.

Returns:
```json
{
  "symbol": "utils/validate.ts:validate",
  "definition": {
    "nodeId": "utils/validate.ts",
    "type": "file",
    "name": "utils/validate.ts",
    "relationship": "defines",
    "file": "utils/validate.ts",
    "line": 3
  },
  "references": [
    { "nodeId": "utils/validate.ts", "type": "file", "name": "utils/validate.ts", "relationship": "exports", "file": "utils/validate.ts", "line": 1 },
    { "nodeId": "server.ts:handleRequest", "type": "function", "name": "handleRequest", "relationship": "calls", "file": "server.ts", "line": 12 },
    { "nodeId": "index.ts", "type": "file", "name": "index.ts", "relationship": "imports", "file": "index.ts" }
  ],
  "count": 3
}
```

An unknown symbol returns `{ symbol, definition: null, references: [], count: 0 }` rather than an error.

### `refactor_rename_impact`

Preview what a rename would affect. Reports only — nothing is modified.

```json
{ "symbol": "validate", "newName": "validateInput" }
```

Returns:
```json
{
  "symbol": "utils/validate.ts:validate",
  "newName": "validateInput",
  "affected": [
    { "file": "utils/validate.ts", "nodeId": "utils/validate.ts", "relationship": "definition" },
    { "file": "utils/validate.ts", "nodeId": "utils/validate.ts", "relationship": "exports" },
    { "file": "server.ts", "nodeId": "server.ts:handleRequest", "relationship": "calls" },
    { "file": "index.ts", "nodeId": "index.ts", "relationship": "imports" }
  ],
  "count": 4
}
```

For an exported symbol the declaring file appears twice — once as the `definition` and once as an `exports` reference. Those are two separate things a rename has to touch in that file, so it is not double-counting, but it does mean `count` exceeds the number of distinct files.

`newName` is echoed back and otherwise unused — there is no validity check on it, and no attempt to detect that the new name already exists. It's there so the output reads as a description of a specific proposed change.

## What counts as a reference

Any relationship on an edge touching the node is collected. In practice that means:

| Relationship | Meaning |
|--------------|---------|
| `defines` | The file that declares the symbol. Reported as `definition`, not as a reference. |
| `exports` | The file that exports it, reported as a reference |
| `calls` | A function that calls it, or a function it calls |
| `imports` | A file importing the symbol, matched on the edge's `specifiers` metadata |
| `has_method` | The class owning it, when the symbol is a method |
| `dynamic_imports` | A file that imports it dynamically |

`line` comes from the node at the other end of the edge, except on the `definition` entry, where it is the *target symbol's* line — that being the more useful number. Specifier-matched `imports` entries carry no `line` at all.

Both directions are collected: edges pointing *at* the symbol, and edges pointing *from* it. So `refactor_refs` on a function returns both its callers and its callees. That is broader than "references" strictly implies — it is the symbol's whole immediate neighbourhood, which is usually what you want before changing it. `defines` and `exports` edges pointing *outward* are skipped, which is what stops a query focused on a file from listing every symbol that file declares.

## API for Other Modules

Refactor exposes `ctx.refactor`:

| Method | Signature | Description |
|--------|-----------|-------------|
| `findRefs` | `(symbol: string) => FindRefsResult` | Definition plus all references |
| `renameImpact` | `(symbol: string, newName: string) => RenameImpact` | Affected files and nodes |

```ts
const impact = ctx.refactor.renameImpact("validate", "validateInput");
const files = new Set(impact.affected.map(a => a.file));
console.error(`${files.size} files would need editing`);
```

## Limits

Accuracy is exactly the scanner's accuracy. Three consequences worth knowing:

- **Call edges resolve within a file, or across an import.** A call to a function reached some other way — re-exported through a barrel, accessed off an object, invoked dynamically — has no edge and so no reference. Treat the result as a floor, not a complete set.
- **`extends` and `implements` don't resolve.** The scanner records those edges with a bare type name as the target — `d.ts:Derived -extends-> Base`, not `-> b.ts:Base`. So asking for references to a base class finds nothing: the incoming match never fires because real node ids are file-qualified, and from the other side the target isn't a node so the edge is dropped. Subclasses and implementers are therefore not reported. The rows are in the table above because the relationships exist; they only fire if a bare name happens to also be a node id.
- **Nothing is rewritten.** Both tools are read-only. `refactor_rename_impact` tells you where to look; performing the rename is your editor's job.
