/**
 * Example: Full module stack server.
 *
 * Loads all built-in modules and scans its own project directory
 * to demonstrate the complete analysis pipeline.
 *
 * Run:   bun examples/modules.ts
 * Test:  echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | bun examples/modules.ts
 */
import { loadModules, serve } from "../src/mcp";
import recall from "../src/modules/recall";
import patterns from "../src/modules/patterns";
import beacon from "../src/modules/beacon";
import scanner from "../src/modules/scanner";
import query from "../src/modules/query";
import graphExport from "../src/modules/export";
import diff from "../src/modules/diff";
import stats from "../src/modules/stats";
import refactor from "../src/modules/refactor";
import prompt from "../src/modules/prompt";

await loadModules([
  recall({ dbPath: ":memory:" }),
  patterns(),
  beacon(),
  scanner(),
  query(),
  graphExport(),
  diff(),
  stats(),
  refactor(),
  prompt(),
]);

serve({
  name: "tiny-mcp-modules-example",
  version: "1.0.0",
  toolTimeout: 30_000,
});
