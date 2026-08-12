/**
 * Reproduces the measurements the audit tickets are written against.
 * Not part of the test suite — run it by hand:
 *   bun run bench/audit-criteria.ts /tmp/w/big
 */
import { loadModules, _reset, closeModules, handleRequest } from "../src/mcp";
import recall from "../src/modules/recall";
import patterns from "../src/modules/patterns";
import beacon from "../src/modules/beacon";
import scanner from "../src/modules/scanner";
import query from "../src/modules/query";
import { Database } from "bun:sqlite";

const dir = process.argv[2] || "/tmp/w/big";
const dbPath = process.argv[3] || "/tmp/bench-run.db";

async function call(name: string, args: unknown) {
  const r = await handleRequest({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) as any;
  if (!r.result) throw new Error(JSON.stringify(r.error));
  return JSON.parse(r.result.content[0].text);
}

const ms = (t: number) => `${(performance.now() - t).toFixed(0)} ms`;

_reset();
await loadModules([recall({ dbPath }), patterns(), beacon(), scanner(), query()]);

let t = performance.now();
const sc = await call("scanner_scan", { dir });
console.log(`cold scan            ${ms(t).padStart(9)}   files=${sc.files} nodes=${sc.nodes} edges=${sc.edges}`);

t = performance.now();
const rescan = await call("scanner_scan", { dir });
console.log(`warm rescan          ${ms(t).padStart(9)}   skipped=${rescan.skipped}`);

t = performance.now();
const s1 = await call("beacon_search", { query: "handler", maxResults: 20 });
console.log(`first search         ${ms(t).padStart(9)}   count=${s1.count}  reported total_ms=${s1.timing.total_ms} index_ms=${s1.timing.index_ms ?? "n/a"}`);

t = performance.now();
const s2 = await call("beacon_search", { query: "Service42", maxResults: 20 });
console.log(`warm search          ${ms(t).padStart(9)}   count=${s2.count}  reported total_ms=${s2.timing.total_ms}`);

t = performance.now();
await call("beacon_reindex", {});
console.log(`reindex              ${ms(t).padStart(9)}`);

const db = new Database(dbPath, { readonly: true });
const one = (sql: string) => db.prepare(sql).get() as any;
console.log(`\nindex contents`);
console.log(`  beacon_fts docs            ${one("SELECT count(*) c FROM beacon_fts").c}`);
console.log(`  ...module-internal keys    ${one("SELECT count(*) c FROM beacon_fts WHERE key LIKE 'scanner:%' OR key LIKE 'prompt:%' OR key LIKE 'diff:%'").c}`);
console.log(`  indexed description bytes  ${one("SELECT coalesce(sum(length(description)),0) c FROM beacon_fts").c}`);
console.log(`  journal_mode / synchronous ${one("PRAGMA journal_mode").journal_mode} / ${one("PRAGMA synchronous").synchronous}`);
console.log(`  db file size               ${(Bun.file(dbPath).size / 1e6).toFixed(1)} MB`);
db.close();

console.log(`\nsearch result keys (first 5)`);
console.log(`  handler:   ${s1.results.slice(0, 5).map((r: any) => r.key).join(", ")}`);
console.log(`  Service42: ${s2.results.slice(0, 5).map((r: any) => r.key).join(", ")}`);

const a = await call("query_find", { type: "function", where: { complexity: { gt: 3 } }, limit: 5 });
const b = await call("query_find", { search: "handler", where: { complexity: { gt: 3 } }, limit: 5 });
console.log(`\nquery_find type+where    ${a.count} results`);
console.log(`query_find search+where  ${b.count} results`);

await closeModules();
