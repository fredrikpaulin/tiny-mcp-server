# Resources and Templates

MCP resources let clients read data from your server. tiny-mcp-server supports two kinds: static resources with a fixed URI and resource templates with variable URIs.

## Static Resources

A static resource has a fixed URI and returns data when read.

```ts
import { registerResource } from "tiny-mcp-server";

registerResource(
  "info://server",
  "Server Info",
  "Returns server metadata",
  "application/json",
  async () => JSON.stringify({ name: "my-server", uptime: process.uptime() })
);
```

Clients discover resources via `resources/list` and read them via `resources/read` with the URI.

### Text vs Binary

The handler return type determines the encoding. Strings are sent as text, `Uint8Array` values are base64-encoded automatically:

```ts
// Text resource
registerResource(
  "config://app",
  "App Config",
  "Application configuration",
  "text/yaml",
  async () => await Bun.file("config.yaml").text()
);

// Binary resource
registerResource(
  "image://logo",
  "Logo",
  "Company logo image",
  "image/png",
  async () => await Bun.file("logo.png").bytes()
);
```

The response format reflects the type:

```json
// Text: { "uri": "...", "mimeType": "...", "text": "..." }
// Binary: { "uri": "...", "mimeType": "...", "blob": "base64..." }
```

## Resource Templates

Templates define a URI pattern with variables. When a client reads a URI that matches the pattern, the variables are extracted and passed to the handler.

```ts
import { registerResourceTemplate } from "tiny-mcp-server";

registerResourceTemplate(
  "file://{path}",
  "File",
  "Read a file from disk",
  "text/plain",
  async ({ path }) => await Bun.file(path).text()
);
```

### Multiple Variables

Templates can have multiple variables:

```ts
registerResourceTemplate(
  "db://{schema}/{table}",
  "Database Table",
  "Read rows from a database table",
  "application/json",
  async ({ schema, table }) => {
    const rows = await db.query(`SELECT * FROM ${schema}.${table} LIMIT 100`);
    return JSON.stringify(rows);
  }
);
```

A `resources/read` request with URI `db://public/users` passes `{ schema: "public", table: "users" }` to the handler.

### Greedy Matching

Template variables use greedy matching (`.+`), so a single variable can capture path-like strings:

```ts
registerResourceTemplate(
  "path://{full}",
  "Path",
  "Read by full path",
  "text/plain",
  async ({ full }) => full  // "path://a/b/c" → full = "a/b/c"
);
```

## Resolution Priority

When a URI matches both a static resource and a template, the static resource wins:

```ts
registerResource("data://config", ...);          // matches "data://config" exactly
registerResourceTemplate("data://{id}", ...);     // would also match "data://config"

// resources/read with uri "data://config" → uses the static resource
// resources/read with uri "data://other" → uses the template
```

## Error Handling

If a resource or template handler throws, the server returns a JSON-RPC error with code `-32603`:

```ts
registerResource("bad://data", "Bad", "Fails", "text/plain", async () => {
  throw new Error("database connection lost");
});
// Response: { "error": { "code": -32603, "message": "Error: database connection lost" } }
```

Reading a URI that matches no resource or template returns a `-32601` error:

```json
{ "error": { "code": -32601, "message": "Unknown resource: nope://missing" } }
```

## Listing

Clients call `resources/list` to discover available resources. The response includes both static resources and templates:

```json
{
  "resources": [
    { "uri": "info://server", "name": "Server Info", "description": "...", "mimeType": "application/json" }
  ],
  "resourceTemplates": [
    { "uriTemplate": "env://{name}", "name": "Environment Variable", "description": "...", "mimeType": "text/plain" }
  ]
}
```
