# Changelog

## 0.1.0

### Added
- **Input validation**: Tool inputs are now validated against their JSON Schema before the handler runs. Covers `type`, `required`, `properties` (recursive), `enum`, `items`, `minimum`/`maximum`, `minLength`/`maxLength`. Validation can be disabled per tool with `{ validateInput: false }`.
- **ToolError class**: Exported error class with a string `code` field for structured error responses. Handler errors now include `code` in the response (`"internal_error"` for plain errors, or a custom code for `ToolError`).
- **validateInput()**: Exported function for standalone use outside the request lifecycle.
- **handleRequest()**: Exported for direct unit testing.
- **_reset()**: Exported helper to clear registrations between tests.
- **Test suite**: Comprehensive test coverage with `bun:test` — unit tests for all MCP methods, validation, and ToolError, plus integration tests over stdio transport.
- **Documentation**: Added `docs/` folder with full API reference, guides for validation, error handling, resources, sampling, and testing, plus a HOWTO for AI agents implementing a server.

### Changed
- `registerTool()` accepts an optional 5th `options` parameter (`{ validateInput?: boolean }`).
- Error responses from tool handlers now include a `code` field alongside `isError` and `error`.
- README.md rewritten as a concise overview and getting started guide, with detailed docs moved to `docs/`.

## 0.0.1

Initial release — JSON-RPC over stdio, tool/resource/resource-template registration, sampling support.
