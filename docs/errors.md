# Error Handling

tiny-mcp-server provides structured error codes so MCP clients can distinguish between error types and respond appropriately.

## ToolError

`ToolError` is an exported class that lets handlers throw typed errors with a machine-readable code.

```ts
import { ToolError } from "tiny-mcp-server";

registerTool("read_file", "Read a file from disk", schema, async ({ path }) => {
  if (!await Bun.file(path).exists()) {
    throw new ToolError("not_found", `File "${path}" not found`);
  }
  return await Bun.file(path).text();
});
```

The client receives:

```json
{
  "isError": true,
  "code": "not_found",
  "error": "Error: File \"config.json\" not found"
}
```

## Error Response Format

All tool errors follow the same shape:

```json
{
  "isError": true,
  "code": "<string>",
  "error": "<string>"
}
```

The `code` field is determined by the error type:

| Error Source | `code` Value | When |
|---|---|---|
| `ToolError` | Your custom code | Handler throws `new ToolError(code, message)` |
| Input validation | `"validation_failed"` | Arguments don't match the tool's schema |
| Any other `Error` | `"internal_error"` | Handler throws a plain `Error` or anything else |

Validation errors also include an `errors` array with field-level details:

```json
{
  "isError": true,
  "code": "validation_failed",
  "errors": [
    { "path": "name", "message": "required" },
    { "path": "count", "message": "expected number, got string" }
  ]
}
```

## Suggested Error Codes

Error codes are free-form strings. Here are some conventions that work well:

| Code | Meaning |
|------|---------|
| `not_found` | A referenced entity doesn't exist |
| `already_exists` | Tried to create something that already exists |
| `permission_denied` | Not authorized for this operation |
| `invalid_state` | The operation isn't valid in the current state |
| `rate_limited` | Too many requests |
| `external_error` | An external service call failed |
| `validation_failed` | Reserved — used by automatic input validation |
| `internal_error` | Reserved — used for untyped handler errors |

## Patterns

### Wrapping external errors

```ts
registerTool("fetch_data", "Fetch data from API", schema, async ({ url }) => {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new ToolError("external_error", `API returned ${res.status}`);
    return await res.json();
  } catch (e) {
    if (e instanceof ToolError) throw e;
    throw new ToolError("external_error", `Fetch failed: ${e}`);
  }
});
```

### Error helpers

For projects with many tools, a factory function keeps things concise:

```ts
const notFound = (what: string) => new ToolError("not_found", `${what} not found`);
const badState = (msg: string) => new ToolError("invalid_state", msg);

// In handlers:
if (!project) throw notFound(`Project "${name}"`);
if (project.locked) throw badState("Project is locked for editing");
```

### Client-side handling

Clients can branch on the `code` field:

```ts
const result = JSON.parse(response.content[0].text);
if (result.isError) {
  switch (result.code) {
    case "not_found":
      // Show a "not found" message
      break;
    case "validation_failed":
      // Highlight the invalid fields using result.errors
      break;
    default:
      // Generic error handling
  }
}
```

## JSON-RPC Level Errors

Some errors are returned at the JSON-RPC level (in `response.error` rather than `response.result`). These are protocol-level issues, not tool-level errors:

| Code | Meaning |
|------|---------|
| `-32601` | Unknown method, unknown tool, or unknown resource |
| `-32603` | Internal error in resource handler |

Tool handler errors are always returned inside `response.result.content` so the client can distinguish between "the tool ran and reported an error" and "the tool couldn't be found at all".
