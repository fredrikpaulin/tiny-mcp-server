/**
 * Scanner module — auto-populates the Patterns graph by walking a directory
 * and parsing JS/TS files. Uses the skeleton parser for AST extraction.
 * Incremental: tracks file hashes to skip unchanged files on rescan.
 * Depends on Recall (for hash cache) and Patterns (for graph population).
 */
import type { ModuleMetadata, ModuleContext } from "../mcp";
import type { RecallAPI } from "./recall";
import type { PatternsAPI } from "./patterns";

// @ts-ignore — JS parser has no types
import { parseModule } from "../analyzer/parser.js";
// @ts-ignore
import {
  FUNC_EXPORTED, FUNC_ASYNC, FUNC_GENERATOR, FUNC_ARROW, FUNC_METHOD, FUNC_STATIC,
  CLASS_EXPORTED, VAR_EXPORTED,
  EFFECT_NONE, EFFECT_DB_READ, EFFECT_DB_WRITE, EFFECT_FILE_READ, EFFECT_FILE_WRITE,
  EFFECT_NETWORK, EFFECT_CONSOLE, EFFECT_PROCESS, EFFECT_DOM, EFFECT_STORAGE,
  getFunction,
} from "../analyzer/ast.js";

const EFFECT_LABELS: Record<number, string> = {
  [EFFECT_DB_READ]: "db_read", [EFFECT_DB_WRITE]: "db_write",
  [EFFECT_FILE_READ]: "file_read", [EFFECT_FILE_WRITE]: "file_write",
  [EFFECT_NETWORK]: "network", [EFFECT_CONSOLE]: "console",
  [EFFECT_PROCESS]: "process", [EFFECT_DOM]: "dom", [EFFECT_STORAGE]: "storage",
};

export interface ScanResult {
  files: number;
  parsed: number;
  skipped: number;
  errors: string[];
  nodes: number;
  edges: number;
  interfaces: number;
  typeAliases: number;
  timing_ms: number;
}

export interface ScannerAPI {
  scan(dir: string, opts?: { force?: boolean }): Promise<ScanResult>;
  watch(dir: string, opts?: { debounce?: number }): void;
  unwatch(): void;
  watching: boolean;
}

const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", ".next", "coverage", ".git",
  "__pycache__", ".turbo", ".cache", ".output", "vendor",
]);
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const MAX_FILE_SIZE = 500_000; // 500KB

function relativePath(base: string, full: string) {
  const rel = full.startsWith(base) ? full.slice(base.length) : full;
  return rel.startsWith("/") ? rel.slice(1) : rel;
}

function resolveImportSource(importerDir: string, source: string, base: string): string | null {
  if (!source.startsWith(".") && !source.startsWith("/")) return null;
  let resolved = source.startsWith(".")
    ? `${importerDir}/${source}`.replace(/\/\.\//g, "/")
    : source;
  const parts = resolved.split("/");
  const stack: string[] = [];
  for (const p of parts) {
    if (p === "..") stack.pop();
    else if (p !== ".") stack.push(p);
  }
  resolved = stack.join("/");
  const ext = resolved.match(/\.[a-z]+$/)?.[0];
  if (!ext || !EXTENSIONS.has(ext)) {
    for (const e of [".ts", ".tsx", ".js", ".jsx"]) {
      const candidate = `${resolved}${e}`;
      if (candidate) return relativePath(base, candidate);
    }
    return relativePath(base, `${resolved}/index.ts`);
  }
  return relativePath(base, resolved);
}

export default function scanner(config: { ignore?: string[] } = {}) {
  const extraIgnore = new Set(config.ignore || []);

  // Hoisted so close() can access them
  let watcher: any = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    name: "scanner",
    depends: ["recall", "patterns"],

    init(ctx: ModuleContext) {
      const recall = ctx.recall as RecallAPI;
      const patterns = ctx.patterns as PatternsAPI;
      if (!recall || !patterns) throw new Error("Scanner requires Recall and Patterns modules");

      const cache = recall.namespace("scanner");

      async function discoverFiles(dir: string): Promise<string[]> {
        const glob = new Bun.Glob("**/*.{ts,tsx,js,jsx}");
        const files: string[] = [];
        for await (const path of glob.scan({ cwd: dir, absolute: true })) {
          const segments = path.split("/");
          const skip = segments.some(s => SKIP_DIRS.has(s) || extraIgnore.has(s));
          if (skip) continue;
          files.push(path);
        }
        return files;
      }

      async function scan(dir: string, opts: { force?: boolean } = {}): Promise<ScanResult> {
        const t0 = performance.now();
        const base = dir.endsWith("/") ? dir : dir + "/";
        const files = await discoverFiles(dir);
        const errors: string[] = [];
        let parsed = 0, skipped = 0, nodeCount = 0, edgeCount = 0;
        let ifaceCount = 0, typeAliasCount = 0;

        for (const file of files) {
          try {
            const stat = Bun.file(file);
            if (stat.size > MAX_FILE_SIZE) { skipped++; continue; }

            const content = await stat.text();
            const hash = Bun.hash(content).toString();
            const relPath = relativePath(base, file);

            if (!opts.force) {
              const cached = cache.get(`hash:${relPath}`);
              if (cached === hash) { skipped++; continue; }
            }

            const result = parseModule(content, relPath);
            if (result.hadError) {
              errors.push(`${relPath}: ${result.errorMsg}`);
              continue;
            }
            parsed++;
            cache.set(`hash:${relPath}`, hash);

            const ast = result.ast;
            const fileDir = relPath.includes("/") ? relPath.slice(0, relPath.lastIndexOf("/")) : "";

            // Build import name → target file map for cross-file call resolution
            const importNameToFile = new Map<string, string>();
            for (const imp of ast.imports) {
              const target = resolveImportSource(fileDir, imp.source, base);
              if (!target) continue;
              for (const spec of imp.specifiers || []) {
                const localName = spec.local || spec.imported;
                if (localName) importNameToFile.set(localName, target);
              }
            }

            // --- File node ---
            patterns.addNode(relPath, "file", relPath, {
              functions: ast.functions.length,
              classes: ast.classes.length,
              imports: ast.imports.length,
              exports: ast.exports.length,
              interfaces: ast.interfaces?.length || 0,
              typeAliases: ast.typeAliases?.length || 0,
            });
            nodeCount++;

            // --- Function nodes ---
            for (const fn of ast.functions) {
              if (!fn.name || fn.name === "(anonymous)") continue;
              const fnId = `${relPath}:${fn.name}`;
              const isExported = !!(fn.flags & FUNC_EXPORTED);
              const meta: Record<string, unknown> = {
                params: fn.params?.map((p: any) => p.name) || [],
                line: fn.loc?.line,
                exported: isExported,
                async: !!(fn.flags & FUNC_ASYNC),
                complexity: fn.complexity ?? 1,
                cognitive: fn.cognitive ?? 0,
                maxNesting: fn.maxNesting ?? 0,
                loopCount: fn.loopCount ?? 0,
                lineCount: fn.lineCount ?? 0,
              };
              if (fn.flags & FUNC_GENERATOR) meta.generator = true;
              if (fn.flags & FUNC_ARROW) meta.arrow = true;
              if (fn.returnType) meta.returnType = fn.returnType;
              if (fn.decorators?.length) meta.decorators = fn.decorators.map((d: any) => d.name || d.fullName);
              patterns.addNode(fnId, "function", fn.name, meta);
              nodeCount++;
              patterns.addEdge(relPath, fnId, "defines");
              edgeCount++;
              if (isExported) {
                patterns.addEdge(relPath, fnId, "exports");
                edgeCount++;
              }
            }

            // --- Class nodes ---
            for (const cls of ast.classes) {
              if (!cls.name) continue;
              const clsId = `${relPath}:${cls.name}`;
              const isExported = !!(cls.flags & CLASS_EXPORTED);
              const meta: Record<string, unknown> = {
                line: cls.loc?.line,
                exported: isExported,
              };
              if (cls.extends) meta.extends = cls.extends;
              if (cls.implements?.length) meta.implements = cls.implements;
              if (cls.decorators?.length) meta.decorators = cls.decorators.map((d: any) => d.name || d.fullName);
              patterns.addNode(clsId, "class", cls.name, meta);
              nodeCount++;
              patterns.addEdge(relPath, clsId, "defines");
              edgeCount++;
              if (isExported) {
                patterns.addEdge(relPath, clsId, "exports");
                edgeCount++;
              }
              if (cls.extends) {
                patterns.addEdge(clsId, cls.extends, "extends");
                edgeCount++;
              }
              // Implements edges
              for (const iface of cls.implements || []) {
                patterns.addEdge(clsId, iface, "implements");
                edgeCount++;
              }
              // Method edges (class → method function)
              for (const methodId of cls.methods || []) {
                const method = getFunction(ast, methodId);
                if (method?.name && method.name !== "(anonymous)") {
                  const methodNodeId = `${relPath}:${cls.name}.${method.name}`;
                  const isStatic = !!(method.flags & FUNC_STATIC);
                  patterns.addNode(methodNodeId, "function", `${cls.name}.${method.name}`, {
                    params: method.params?.map((p: any) => p.name) || [],
                    line: method.loc?.line,
                    method: true,
                    static: isStatic,
                    complexity: method.complexity ?? 1,
                    cognitive: method.cognitive ?? 0,
                  });
                  nodeCount++;
                  patterns.addEdge(clsId, methodNodeId, "has_method");
                  edgeCount++;
                }
              }
            }

            // --- Import edges (file → file) ---
            for (const imp of ast.imports) {
              const target = resolveImportSource(fileDir, imp.source, base);
              if (target) {
                patterns.addEdge(relPath, target, "imports", {
                  specifiers: imp.specifiers?.map((s: any) => s.local || s.imported).filter(Boolean),
                  typeOnly: imp.isTypeOnly || false,
                });
                edgeCount++;
              }
            }

            // --- Dynamic import edges ---
            for (const di of ast.dynamicImports || []) {
              if (!di.isResolvable || !di.source) continue;
              const target = resolveImportSource(fileDir, di.source, base);
              if (target) {
                patterns.addEdge(relPath, target, "dynamic_imports");
                edgeCount++;
              }
            }

            // --- Variable nodes (exported only) ---
            for (const v of ast.variables || []) {
              if (!(v.flags & VAR_EXPORTED) || !v.name) continue;
              const varId = `${relPath}:${v.name}`;
              const meta: Record<string, unknown> = { line: v.loc?.line, exported: true };
              if (v.typeAnnotation) meta.typeAnnotation = v.typeAnnotation;
              patterns.addNode(varId, "variable", v.name, meta);
              nodeCount++;
              patterns.addEdge(relPath, varId, "exports");
              edgeCount++;
            }

            // --- Interface nodes ---
            for (const iface of ast.interfaces || []) {
              if (!iface.name) continue;
              const ifaceId = `${relPath}:${iface.name}`;
              patterns.addNode(ifaceId, "interface", iface.name, {
                line: iface.loc?.line,
                extends: iface.extends?.length ? iface.extends : undefined,
              });
              nodeCount++;
              ifaceCount++;
              patterns.addEdge(relPath, ifaceId, "defines");
              edgeCount++;
              for (const ext of iface.extends || []) {
                patterns.addEdge(ifaceId, ext, "extends");
                edgeCount++;
              }
            }

            // --- Type alias nodes ---
            for (const ta of ast.typeAliases || []) {
              if (!ta.name) continue;
              const taId = `${relPath}:${ta.name}`;
              patterns.addNode(taId, "type", ta.name, {
                line: ta.loc?.line,
                definition: ta.definition || undefined,
              });
              nodeCount++;
              typeAliasCount++;
              patterns.addEdge(relPath, taId, "defines");
              edgeCount++;
            }

            // --- Call edges (function → function) ---
            for (const call of ast.calls || []) {
              if (!call.callee || !call.containingFunc) continue;
              const callerFn = ast.functions.find((f: any) => f.id === call.containingFunc);
              if (!callerFn?.name || callerFn.name === "(anonymous)") continue;
              // If caller is a class method, use Class.method id
              const callerCls = callerFn.parentClass
                ? ast.classes.find((c: any) => c.id === callerFn.parentClass)
                : null;
              const callerId = callerCls?.name
                ? `${relPath}:${callerCls.name}.${callerFn.name}`
                : `${relPath}:${callerFn.name}`;
              const edgeMeta: Record<string, unknown> = {};
              if (call.fullChain && call.fullChain !== call.callee) edgeMeta.fullChain = call.fullChain;
              if (call.isNew) edgeMeta.isNew = true;
              if (call.isAwait) edgeMeta.isAwait = true;

              // Try same-file resolution
              const calleeFn = ast.functions.find((f: any) => f.name === call.callee);
              if (calleeFn) {
                const calleeCls = calleeFn.parentClass
                  ? ast.classes.find((c: any) => c.id === calleeFn.parentClass)
                  : null;
                const calleeId = calleeCls?.name
                  ? `${relPath}:${calleeCls.name}.${calleeFn.name}`
                  : `${relPath}:${calleeFn.name}`;
                patterns.addEdge(callerId, calleeId, "calls", edgeMeta);
                edgeCount++;
              } else {
                // Cross-file: check if callee matches an imported name
                const targetFile = importNameToFile.get(call.callee);
                if (targetFile) {
                  const calleeId = `${targetFile}:${call.callee}`;
                  patterns.addEdge(callerId, calleeId, "calls", edgeMeta);
                  edgeCount++;
                }
              }
            }

            // --- Side effect edges ---
            for (const se of ast.sideEffects || []) {
              if (se.type === EFFECT_NONE) continue;
              const label = EFFECT_LABELS[se.type];
              if (!label) continue;
              const callerFn = ast.functions.find((f: any) => f.id === se.containingFunc);
              if (!callerFn?.name || callerFn.name === "(anonymous)") continue;
              const callerId = `${relPath}:${callerFn.name}`;
              patterns.addEdge(callerId, `effect:${label}`, "has_effect", {
                type: label,
                apiCall: se.apiCall || undefined,
              });
              edgeCount++;
            }

            ctx.emit?.("scanner:fileScanned", { file: relPath, nodes: nodeCount, edges: edgeCount });

          } catch (e) {
            errors.push(`${file}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        const timing_ms = Math.round((performance.now() - t0) * 100) / 100;
        const summary: ScanResult = {
          files: files.length, parsed, skipped, errors,
          nodes: nodeCount, edges: edgeCount,
          interfaces: ifaceCount, typeAliases: typeAliasCount,
          timing_ms,
        };
        ctx.emit?.("scanner:complete", summary);
        return summary;
      }

      // --- Watch mode ---
      let watchDir = "";

      function watch(dir: string, opts: { debounce?: number } = {}) {
        unwatch();
        const debounceMs = opts.debounce ?? 300;
        watchDir = dir;
        const fs = require("fs");
        watcher = fs.watch(dir, { recursive: true }, (eventType: string, filename: string | null) => {
          if (!filename) return;
          const ext = filename.match(/\.[a-z]+$/)?.[0];
          if (!ext || !EXTENSIONS.has(ext)) return;
          const segments = filename.split("/");
          if (segments.some((s: string) => SKIP_DIRS.has(s) || extraIgnore.has(s))) return;

          // Debounce: batch rapid changes into one rescan
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(async () => {
            debounceTimer = null;
            try {
              const result = await scan(watchDir);
              ctx.emit?.("scanner:watchRescan", result);
            } catch (e) {
              ctx.emit?.("scanner:watchError", { error: e instanceof Error ? e.message : String(e) });
            }
          }, debounceMs);
        });
        ctx.emit?.("scanner:watchStart", { dir });
      }

      function unwatch() {
        if (watcher) {
          watcher.close();
          watcher = null;
        }
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        if (watchDir) {
          ctx.emit?.("scanner:watchStop", { dir: watchDir });
          watchDir = "";
        }
      }

      const api: ScannerAPI = {
        scan,
        watch,
        unwatch,
        get watching() { return watcher !== null; },
      };
      ctx.scanner = api;

      ctx.registerTool(
        "scanner_scan",
        "Scan a directory to auto-populate the context graph with files, functions, classes, imports, interfaces, type aliases, side effects, and call relationships.",
        {
          type: "object",
          required: ["dir"],
          properties: {
            dir: { type: "string", description: "Directory path to scan" },
            force: { type: "boolean", description: "Force rescan of all files (ignore cache)" },
          },
        },
        async ({ dir, force }) => {
          return scan(dir as string, { force: force as boolean | undefined });
        }
      );

      ctx.registerTool(
        "scanner_watch",
        "Start watching a directory for file changes. Automatically rescans when JS/TS files change.",
        {
          type: "object",
          required: ["dir"],
          properties: {
            dir: { type: "string", description: "Directory to watch" },
            debounce: { type: "number", description: "Debounce interval in ms (default 300)" },
          },
        },
        async ({ dir, debounce }) => {
          watch(dir as string, { debounce: debounce as number | undefined });
          return { ok: true, watching: dir };
        }
      );

      ctx.registerTool(
        "scanner_unwatch",
        "Stop watching for file changes.",
        { type: "object", properties: {} },
        async () => {
          const was = watchDir;
          unwatch();
          return { ok: true, stopped: was || null };
        }
      );
    },

    close() {
      // Clean up watcher on module close
      if (watcher) { watcher.close(); watcher = null; }
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    },
  } satisfies ModuleMetadata;
}
