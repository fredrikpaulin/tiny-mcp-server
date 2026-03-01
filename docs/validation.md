# Input Validation

tiny-mcp-server validates tool inputs against their JSON Schema automatically. No dependencies — the validator is built-in and covers the subset of JSON Schema that matters for MCP tool inputs.

## How It Works

When a client calls `tools/call`, the server validates the `arguments` against the tool's `schema` before invoking the handler. If validation fails, the handler is never called and the client receives a structured error response with field-level details.

```ts
registerTool(
  "create_user",
  "Create a new user",
  {
    type: "object",
    required: ["name", "email"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 100 },
      email: { type: "string" },
      age: { type: "integer", minimum: 0, maximum: 150 }
    }
  },
  async ({ name, email, age }) => {
    // No need to validate here — inputs are guaranteed to match the schema
    return await createUser(name, email, age);
  }
);
```

Calling this tool with `{ "email": 42 }` returns:

```json
{
  "isError": true,
  "code": "validation_failed",
  "errors": [
    { "path": "name", "message": "required" },
    { "path": "email", "message": "expected string, got number" }
  ]
}
```

## Supported Schema Keywords

The validator supports these JSON Schema keywords:

### type

Checks the JavaScript type of a value. Supported types: `"string"`, `"number"`, `"integer"`, `"boolean"`, `"array"`, `"object"`, `"null"`.

The `"integer"` type checks that the value is a number and that `Number.isInteger()` is true.

```ts
{ type: "string" }    // accepts "hello", rejects 42
{ type: "integer" }   // accepts 5, rejects 5.5
{ type: "array" }     // accepts [1, 2], rejects "not array"
```

### required

An array of property names that must be present on an object. Only checked when the value is an object.

```ts
{ type: "object", required: ["name", "email"] }
```

### properties

A map of property names to sub-schemas. Each property present on the object is validated recursively against its sub-schema. Properties that are absent (and not in `required`) are skipped.

```ts
{
  type: "object",
  properties: {
    name: { type: "string" },
    config: {
      type: "object",
      required: ["host"],
      properties: {
        host: { type: "string" },
        port: { type: "number" }
      }
    }
  }
}
```

### enum

A list of allowed values. The value must match one of them exactly.

```ts
{ type: "string", enum: ["json", "xml", "csv"] }
```

### items

Schema for array elements. Each element in the array is validated against this schema.

```ts
{ type: "array", items: { type: "string" } }  // all elements must be strings
```

### minLength / maxLength

String length constraints.

```ts
{ type: "string", minLength: 1, maxLength: 255 }
```

### minimum / maximum

Numeric range constraints.

```ts
{ type: "number", minimum: 0, maximum: 100 }
```

## Error Format

Validation errors are returned as an array of objects with `path` and `message`:

```json
{ "path": "name", "message": "required" }
{ "path": "config.host", "message": "expected string, got number" }
{ "path": "tags[2]", "message": "expected string, got number" }
{ "path": "format", "message": "must be one of: json, xml, csv" }
{ "path": "age", "message": "must be >= 0" }
```

The `path` uses dot notation for nested objects and bracket notation for array indices. Top-level type errors use `"."` as the path.

## Opting Out

Some tools accept arbitrary input or handle validation internally. Pass `{ validateInput: false }` as the fifth argument to `registerTool`:

```ts
registerTool(
  "execute",
  "Execute arbitrary code",
  { type: "object", properties: { code: { type: "string" } } },
  async ({ code }) => eval(code),
  { validateInput: false }
);
```

When validation is disabled, the schema is still returned in `tools/list` for client-side use — it just isn't enforced server-side.

## Standalone Use

The `validateInput` function is exported for use outside the request lifecycle:

```ts
import { validateInput } from "tiny-mcp-server";

const errors = validateInput(mySchema, someData);
if (errors.length) {
  console.error("Invalid:", errors);
}
```

## What's Not Covered

The validator intentionally skips advanced JSON Schema features to keep the implementation small. These are not supported: `oneOf`, `anyOf`, `allOf`, `not`, `$ref`, `additionalProperties`, `patternProperties`, `if`/`then`/`else`, `format`, `const`, `dependencies`. If you need these, validate manually in your handler and disable automatic validation with `{ validateInput: false }`.
