# tiny-mcp-server — Change Requests

Feedback from building PEN (42 MCP tools, fiction writing toolkit) on top of tiny-mcp-server.

## 1. Automatic Input Validation Against Tool Schemas

**Priority: High**

Every tool already declares a JSON Schema for its input. Currently, each handler has to manually validate required fields, types, and enums — or risk cryptic runtime errors. If tiny-mcp-server validated inputs against the declared schema before calling the handler, it would eliminate a significant amount of boilerplate.

**Current pattern (repeated in every handler):**
```js
async function my_tool({ project, format }) {
  if (!project) throw new Error("project is required");
  if (format && !["a", "b"].includes(format)) throw new Error("invalid format");
  // ... actual logic
}
```

**Desired behavior:**
- Validate incoming params against the tool's `schema` before invoking `handler`
- Return a proper MCP error response (not an unhandled exception) with field-level details
- Skip validation if the tool opts out (e.g. `{ validateInput: false }`)

This is the single highest-impact improvement. Every tool benefits, and the schema information already exists.

## 2. Structured Error Codes

**Priority: Medium**

MCP supports error codes and structured error data, but there's currently no ergonomic way to throw typed errors from a handler. Everything becomes a generic string error on the client side.

**Suggestion:** Expose an error class or factory:
```js
import { ToolError } from "tiny-mcp-server";

async function read_project({ project }) {
  const exists = await checkExists(project);
  if (!exists) throw new ToolError("not_found", `Project "${project}" doesn't exist`);
  // ...
}
```

This would let clients distinguish between "not found" (show message), "validation failed" (highlight fields), and "internal error" (retry or escalate).

## 3. Tool Grouping / Categorization

**Priority: Low**

With 42 tools, the flat list is hard to navigate for clients that enumerate available tools. An optional `group` or `category` field in tool registration would help clients build better UIs.

**Suggestion:**
```js
registerTool("create_character", "Create a character", schema, handler, { group: "characters" });
```

Or allow a `groups` metadata in `serve()`:
```js
serve({
  name: "pen",
  version: "1.0.0",
  toolGroups: {
    "project": ["list_projects", "read_project", "create_project", ...],
    "ai": ["writer", "editor", "brainstorm", ...]
  }
});
```

This may be outside the current MCP spec, but would be valuable as a convention or extension.

## 4. Middleware / Before-Handler Hooks

**Priority: Medium**

Many handlers share the same preamble: verify a project exists, load its data, check permissions. A middleware or hook system would reduce duplication.

**Suggestion:**
```js
registerTool("read_character", desc, schema, handler, {
  before: [requireProject]  // runs before handler, can throw to abort
});
```

Or a more general middleware approach:
```js
const withProject = (handler) => async (params) => {
  const proj = await loadProject(params.project);
  if (!proj) throw new ToolError("not_found", "Project not found");
  return handler(params, { project: proj });
};

registerTool("read_character", desc, schema, withProject(handler));
```

The second pattern already works at the application level, but first-class support would make the convention clearer and allow middleware to hook into the MCP lifecycle (logging, timing, etc.).

## 5. Streaming Tool Responses

**Priority: Low (but high UX impact)**

AI-proxying tools (writer, editor, brainstorm) call `sampleFn` which returns the full response at once. MCP supports streaming, but there's no obvious way to stream a tool's response incrementally.

**Suggestion:** Support a generator or callback pattern for tool handlers:
```js
registerTool("writer", desc, schema, async function* (params) {
  for await (const chunk of streamFromAI(params)) {
    yield chunk;  // sent to client incrementally
  }
});
```

This would make AI writing tools feel significantly more responsive, especially for long-form generation (manuscripts, outlines, podcast scripts).

---

## Context

These suggestions come from building a real-world MCP server with:
- 42 tools (CRUD for 5 entity types + 12 AI tools + export/analysis tools)
- Hand-rolled input validation in every handler
- Repeated project-loading boilerplate across ~30 tools
- AI tools that proxy sampling and would benefit from streaming
- A tool list that's grown large enough to need categorization
