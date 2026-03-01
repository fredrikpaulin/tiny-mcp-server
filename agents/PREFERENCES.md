# PREFERENCES.md — Working Preferences for Claude Cowork

Guidelines for AI agents collaborating with Fredrik on Bun and C projects.

## Language and Runtime

The default stack is Bun for JavaScript/TypeScript projects and C for systems work. Do not suggest Node.js, Deno, or other runtimes unless explicitly asked. When writing JavaScript, target Bun's APIs directly — `Bun.file()`, `Bun.serve()`, `bun:test`, `Bun.spawn()` — rather than falling back to Node.js equivalents.

For C projects, keep it standard. Prefer POSIX APIs and avoid platform-specific extensions unless the project demands them.

## Dependencies

Dependencies are a last resort. If a project has dependencies, they are likely first-party (built and maintained by Fredrik). Do not introduce third-party packages without asking. If a feature can be implemented in 50–100 lines of project code, that is preferable to adding a dependency.

Before suggesting `bun install anything`:
1. Check if the project already has a similar utility
2. Check if Bun has a built-in API for it
3. Consider writing it from scratch — it's usually less code than you think

The same applies to C. Prefer implementing small utilities over pulling in libraries. If a library is needed, expect it to be one of Fredrik's own.

## Code Style

Concise functions with minimum abstraction. Flat over nested. One file is fine until it genuinely hurts readability — don't split prematurely. Prefer named exports over default exports. Keep function signatures obvious.

JSON Schema defines data structures. If a project uses schemas, they are the source of truth for validation, documentation, and testing. Don't invent parallel validation logic.

No class hierarchies unless the domain specifically calls for them. Factory functions and plain objects are preferred.

## Testing

Use `bun:test`. Write tests alongside features, not after. The test file structure should mirror the source — if `tools.js` has 40 functions, `tools.test.js` covers all 40.

For anything that calls external services or AI, use a mock that captures calls. Test what gets sent (prompts, parameters), not what comes back.

Bun is not available in the Cowork sandbox. Write the code, verify syntax programmatically (brace/paren balance, import paths), and expect Fredrik to run `bun test` locally and report results. One or two fix rounds from test output is the normal flow.

## Project Structure

Keep it flat. A typical Bun project:

```
project/
  src/ or lib/        — source code
  tests/              — test files
  schemas/            — JSON Schema files (if applicable)
  agents/             — AGENTS.md and related docs
  package.json
  .gitignore
```

Don't create `src/utils/helpers/`, `src/types/`, `src/interfaces/` or similar deep hierarchies. If a utility is used in one file, it lives in that file. If it's used in three files, it gets its own file at the top level of `src/`.

## Working Flow

1. Understand first — read existing code before writing new code
2. If the change is non-trivial (touches multiple files, has architectural implications), plan before implementing
3. Build the feature, write the tests, verify syntax
4. Fredrik runs tests, reports back
5. Fix failures (usually schema mismatches or return shape assumptions)
6. Update documentation if tool counts, APIs, or schemas changed
7. Stage in git when asked

## Documentation

Documentation follows implementation. Don't write docs for planned features. Update docs (README, tool references, schema tables) from the actual source code, not from memory. Tool counts drift — verify them.

AGENTS.md-style files live in `agents/`. They capture project-specific conventions and working principles. CLAUDE.md (gitignored) holds session context for AI continuity.

## Things That Trip Up AI Agents

- `Bun.file(path).size` is a synchronous property, not a promise. Don't `await` it.
- `bun:test` uses `test()` and `describe()`, not `it()` (though `it` works as an alias).
- Bun's `readdir` and file APIs are mostly Node-compatible but not always — check edge cases.
- JSON Schema enums are strict. If a schema says `["outline", "drafted"]`, don't use `"outlined"` in test data.
- When a function returns data, read the implementation to see the actual shape. Don't assume `{ data: { ... } }` wrappers — many functions return the payload directly.
- The Cowork sandbox doesn't have Bun installed. Don't try to run `bun test` — just verify syntax and let Fredrik run tests.

## Audit Habits

After a batch of features, do an audit pass:
- Check for API misuse (sync vs async, wrong return types)
- Verify documentation matches implementation
- Look for dead code or unreachable branches
- Run the test suite and fix anything that drifted

Small bugs compound. Catching them between feature batches costs less than debugging them later.
