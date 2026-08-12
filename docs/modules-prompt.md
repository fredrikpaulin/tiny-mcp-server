# Prompt Builder Module

Builds a minimal LLM prompt for one symbol. Walks the graph outward from a focus node to collect its dependencies, callers and referenced types, then emits just the relevant source lines, grouped by file and held to a token budget.

The point is to send a model exactly the context a change needs, instead of whole files.

## Setup

```ts
import { loadModules, serve } from "tiny-mcp-server";
import recall from "tiny-mcp-server/modules/recall";
import patterns from "tiny-mcp-server/modules/patterns";
import scanner from "tiny-mcp-server/modules/scanner";
import prompt from "tiny-mcp-server/modules/prompt";

await loadModules([
  recall({ dbPath: "./context.db" }),
  patterns(),
  scanner(),
  prompt(),
]);
serve();
```

**Depends on:** `patterns`, `recall`

Scanner isn't a declared dependency, but Prompt needs a graph to walk and files to read, so in practice you load it too. Prompt listens for `scanner:complete` and records the scanned directory, which is how it resolves relative paths without being told.

## Tools

### `prompt_build`

```json
{ "symbol": "validate", "maxTokens": 2000 }
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `symbol` | `string` | required | Node id (`utils/validate.ts:validate`) or bare name |
| `baseDir` | `string` | last scanned dir | Directory to resolve source files against |
| `callers` | `boolean` | `true` | Include functions that call the focus |
| `deps` | `boolean` | `true` | Include what the focus calls, extends or implements |
| `types` | `boolean` | `true` | Include interfaces and type aliases from imported files |
| `imports` | `boolean` | `true` | Include the parent file's import block |
| `maxDepth` | `number` | `1` | Hops to follow when collecting dependencies |
| `maxTokens` | `number` | `4000` | Approximate budget, ~4 chars per token |
| `context` | `number` | `0` | Extra source lines either side of each symbol section. Ignored for file sections, which emit the import block. |

Returns:
```json
{
  "focus": "utils/validate.ts:validate",
  "sections": [
    {
      "nodeId": "utils/validate.ts:validate",
      "type": "function",
      "name": "validate",
      "file": "utils/validate.ts",
      "lines": { "start": 3, "end": 9 },
      "source": "export function validate(u: unknown): boolean {\n  ...\n}",
      "relationship": "focus"
    }
  ],
  "tokenEstimate": 412,
  "prompt": "// --- utils/validate.ts (**FOCUS**) ---\n..."
}
```

`prompt` is the formatted text to send; `sections` is the same content structured, if you'd rather assemble it yourself.

An unresolvable symbol returns a result rather than an error, with `sections: []` and `prompt` set to `// Symbol not found: <name>`.

## What gets collected

Sections are gathered in priority order, and the budget is spent in that order:

1. **focus** — the target symbol. Always included, even if it alone exceeds `maxTokens`.
2. **parent** — the focus's file, contributing its import block.
3. **dependency** — followed outward over `calls`, `extends` and `implements` up to `maxDepth`.
4. **type** — interfaces and type aliases defined in files the focus's file imports.
5. **caller** — functions with a `calls` edge pointing at the focus, one hop only.

Within a category, the first section that would exceed the budget ends *that category* — its remaining candidates are skipped, including ones that would have fit. Lower-priority categories are still attempted, so a small type or caller section can still land after a large dependency was rejected. The focus is exempt from the check entirely.

One consequence worth knowing: a section rejected on budget is already recorded as seen before the check happens, so a later category cannot reconsider it.

The token count is `Math.ceil(chars / 4)` — a rough estimate for code, not a tokeniser. Treat `maxTokens` as approximate and leave headroom.

## Resolving source files

Node ids look like `path/to/file.ts:symbolName`, and the path is relative to whatever directory was scanned. To read the file, Prompt needs that directory:

1. `baseDir`, if you pass it.
2. Otherwise the directory from the most recent `scanner:complete` event, stored in Recall's internal store under `prompt:lastScanDir`.

If neither is available the base is empty, so paths resolve relative to the server's working directory. That happens to work when the server was launched from the scanned directory and fails otherwise — which is a confusing way to fail, so pass `baseDir` if you haven't scanned in this process.

A failed read produces `// Could not read <path>:<start>-<end>` in place of the source rather than throwing, so a partially-resolvable prompt still comes back. The path in that message is the fully resolved one, not the graph-relative id.

Line ranges come from `metadata.line` and `metadata.lineCount` on the node. A node with a line but no count gets a window running from its start line to `line + 20`. A node with neither is skipped.

Both branches read one line past the end — `end` is `line + lineCount`, and the slice is inclusive of `end` — so a section carries the line after the symbol. Harmless in practice, and usually a closing brace.

## API for Other Modules

Prompt exposes `ctx.prompt`:

| Method | Signature | Description |
|--------|-----------|-------------|
| `build` | `(nodeId: string, opts?: PromptOptions) => Promise<PromptResult>` | Build a prompt |

```ts
const { prompt, tokenEstimate } = await ctx.prompt.build("handleRequest", {
  maxTokens: 1500,
  callers: false,
});
const answer = await ctx.sample({
  messages: [{ role: "user", content: { type: "text", text: `${prompt}\n\nWhat could go wrong here?` } }],
});
```

## Limits

Files are read once per section rather than once per file, so a prompt drawing ten sections from the same file reads it ten times. For a handful of sections that is not worth caring about; for very large files it is measurable.

The prompt is assembled from source on every call — nothing is cached — so it always reflects what is on disk, and a hot loop pays full cost each time.
