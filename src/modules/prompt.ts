/**
 * Prompt Builder module — extracts minimal context from the graph for LLM calls.
 *
 * Given a focus node (function, class, file), walks the graph to collect
 * only the relevant subgraph: the target, its dependencies (imports, calls),
 * its callers, and the types/interfaces it references. Then reads the actual
 * source lines and formats them as a compact prompt.
 *
 * Depends on Patterns (graph traversal), Scanner (source dir tracking),
 * and Recall (for caching extracted prompts).
 */
import type { ModuleMetadata, ModuleContext } from "../mcp";
import type { PatternsAPI, PatternsNode, PatternsEdge } from "./patterns";
import type { RecallAPI } from "./recall";

export interface PromptSection {
  nodeId: string;
  type: string;
  name: string;
  file: string;
  lines?: { start: number; end: number };
  source: string;
  relationship: string; // "focus", "dependency", "caller", "type", "parent"
}

export interface PromptResult {
  focus: string;
  sections: PromptSection[];
  tokenEstimate: number;
  prompt: string;
}

export interface PromptOptions {
  /** Include callers of the focus node (default true) */
  callers?: boolean;
  /** Include dependencies the focus node calls (default true) */
  deps?: boolean;
  /** Include types/interfaces referenced (default true) */
  types?: boolean;
  /** Include the parent file's imports section (default true) */
  imports?: boolean;
  /** Max depth for dependency traversal (default 1) */
  maxDepth?: number;
  /** Max total estimated tokens (default 4000) */
  maxTokens?: number;
  /** Context lines before/after a function (default 0) */
  context?: number;
  /** Base directory for resolving source files */
  baseDir?: string;
}

export interface PromptAPI {
  build(nodeId: string, opts?: PromptOptions): Promise<PromptResult>;
}

function fileFromId(id: string): string | undefined {
  const colon = id.indexOf(":");
  return colon > 0 ? id.slice(0, colon) : undefined;
}

// Rough token estimate: ~4 chars per token for code
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export default function prompt() {
  return {
    name: "prompt",
    depends: ["patterns", "recall"],

    init(ctx: ModuleContext) {
      const patterns = ctx.patterns as PatternsAPI;
      const recall = ctx.recall as RecallAPI;
      if (!patterns || !recall) throw new Error("Prompt requires Patterns and Recall modules");

      const cache = recall.namespace("prompt");

      // Read source lines from a file
      async function readLines(filePath: string, start: number, end: number, contextLines: number): Promise<string> {
        const actualStart = Math.max(1, start - contextLines);
        const actualEnd = end + contextLines;
        try {
          const file = Bun.file(filePath);
          const content = await file.text();
          const lines = content.split("\n");
          return lines.slice(actualStart - 1, actualEnd).join("\n");
        } catch {
          return `// Could not read ${filePath}:${start}-${end}`;
        }
      }

      // Read just the import block from a file (lines before the first non-import code)
      async function readImports(filePath: string): Promise<string> {
        try {
          const content = await (Bun.file(filePath)).text();
          const lines = content.split("\n");
          const importLines: string[] = [];
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed === "" || trimmed.startsWith("import ") || trimmed.startsWith("import{") ||
                trimmed.startsWith("from ") || trimmed.startsWith("} from") ||
                trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
              importLines.push(line);
            } else if (importLines.length > 0) {
              break;
            }
          }
          const result = importLines.join("\n").trim();
          return result || "";
        } catch {
          return "";
        }
      }

      // Resolve base directory from recall or a provided option
      function resolveBaseDir(opts: PromptOptions): string {
        if (opts.baseDir) return opts.baseDir.endsWith("/") ? opts.baseDir : opts.baseDir + "/";
        // Try to get from scanner's last scan stored in recall
        const scanDir = cache.get("lastScanDir") as string | null;
        return scanDir ? (scanDir.endsWith("/") ? scanDir : scanDir + "/") : "";
      }

      async function build(nodeId: string, opts: PromptOptions = {}): Promise<PromptResult> {
        const {
          callers: includeCallers = true,
          deps: includeDeps = true,
          types: includeTypes = true,
          imports: includeImports = true,
          maxDepth = 1,
          maxTokens = 4000,
          context: contextLines = 0,
        } = opts;

        // Find the target node
        let node = patterns.getNode(nodeId);
        if (!node) {
          const all = patterns.query({}) as PatternsNode[];
          node = all.find(n => n.name === nodeId) || null;
        }
        if (!node) {
          return { focus: nodeId, sections: [], tokenEstimate: 0, prompt: `// Symbol not found: ${nodeId}` };
        }

        const baseDir = resolveBaseDir(opts);
        const edges = patterns.allEdges();
        const sections: PromptSection[] = [];
        const seen = new Set<string>();
        let totalTokens = 0;

        // Helper: add a section if budget allows
        const addSection = async (
          n: PatternsNode,
          relationship: string,
          priority: number
        ): Promise<boolean> => {
          if (seen.has(n.id)) return true;
          seen.add(n.id);

          const file = n.type === "file" ? n.name : fileFromId(n.id);
          if (!file) return true;

          const meta = n.metadata as any;
          const line = meta?.line;
          const lineCount = meta?.lineCount;

          let source: string;
          let lines: { start: number; end: number } | undefined;

          if (n.type === "file") {
            // For files, just read imports
            source = includeImports ? await readImports(baseDir + file) : "";
          } else if (line && lineCount) {
            lines = { start: line, end: line + lineCount };
            source = await readLines(baseDir + file, line, line + lineCount, contextLines);
          } else if (line) {
            // Have start line but no count — read a reasonable chunk
            lines = { start: line, end: line + 20 };
            source = await readLines(baseDir + file, line, line + 20, contextLines);
          } else {
            return true; // no location info, skip
          }

          if (!source.trim()) return true;

          const tokens = estimateTokens(source);
          if (totalTokens + tokens > maxTokens && relationship !== "focus") {
            return false; // budget exceeded
          }

          totalTokens += tokens;
          sections.push({ nodeId: n.id, type: n.type, name: n.name, file, lines, source, relationship });
          return true;
        };

        // 1. Focus node (always included, highest priority)
        await addSection(node, "focus", 0);

        // 2. Parent file imports (if focus is a function/class, show its file's imports)
        if (includeImports && node.type !== "file") {
          const parentFile = fileFromId(node.id);
          if (parentFile) {
            const fileNode = patterns.getNode(parentFile);
            if (fileNode) await addSection(fileNode, "parent", 1);
          }
        }

        // 3. Dependencies — things this node calls or uses
        if (includeDeps) {
          const depNodes = collectRelated(node.id, edges, "outgoing", ["calls", "extends", "implements"], maxDepth);
          for (const dep of depNodes) {
            const depNode = patterns.getNode(dep);
            if (depNode && !(await addSection(depNode, "dependency", 2))) break;
          }
        }

        // 4. Types/interfaces used (via imports in the same file or extends/implements)
        if (includeTypes) {
          const parentFile = node.type === "file" ? node.id : fileFromId(node.id);
          if (parentFile) {
            const typeNodes = collectFileTypes(parentFile, edges, patterns);
            for (const tn of typeNodes) {
              if (!(await addSection(tn, "type", 3))) break;
            }
          }
        }

        // 5. Callers — things that call this node
        if (includeCallers) {
          const callerIds = collectRelated(node.id, edges, "incoming", ["calls"], 1);
          for (const callerId of callerIds) {
            const callerNode = patterns.getNode(callerId);
            if (callerNode && !(await addSection(callerNode, "caller", 4))) break;
          }
        }

        // Format the prompt
        const promptText = formatPrompt(sections);
        return { focus: node.id, sections, tokenEstimate: totalTokens, prompt: promptText };
      }

      // Collect related node IDs by following edges in a direction
      function collectRelated(
        startId: string,
        edges: PatternsEdge[],
        direction: "outgoing" | "incoming",
        relationships: string[],
        maxDepth: number
      ): string[] {
        const result: string[] = [];
        const visited = new Set<string>([startId]);
        let frontier = [startId];

        for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
          const next: string[] = [];
          for (const id of frontier) {
            for (const e of edges) {
              if (!relationships.includes(e.relationship)) continue;
              const target = direction === "outgoing"
                ? (e.from === id ? e.to : null)
                : (e.to === id ? e.from : null);
              if (target && !visited.has(target)) {
                visited.add(target);
                result.push(target);
                next.push(target);
              }
            }
          }
          frontier = next;
        }
        return result;
      }

      // Find interface/type nodes defined in files that the target file imports
      function collectFileTypes(fileId: string, edges: PatternsEdge[], patterns: PatternsAPI): PatternsNode[] {
        const importedFiles: string[] = [];
        for (const e of edges) {
          if (e.from === fileId && e.relationship === "imports") {
            importedFiles.push(e.to);
          }
        }

        const types: PatternsNode[] = [];
        for (const impFile of importedFiles) {
          for (const e of edges) {
            if (e.from === impFile && e.relationship === "defines") {
              const node = patterns.getNode(e.to);
              if (node && (node.type === "interface" || node.type === "type")) {
                types.push(node);
              }
            }
          }
        }
        return types;
      }

      // Format sections into a readable prompt
      function formatPrompt(sections: PromptSection[]): string {
        if (sections.length === 0) return "// No context available";

        const parts: string[] = [];
        const grouped = new Map<string, PromptSection[]>();

        // Group by file for cleaner output
        for (const s of sections) {
          const key = s.file;
          let group = grouped.get(key);
          if (!group) { group = []; grouped.set(key, group); }
          group.push(s);
        }

        for (const [file, fileSections] of grouped) {
          const labels = fileSections.map(s => s.relationship === "focus" ? `**FOCUS**` : s.relationship).join(", ");
          parts.push(`// --- ${file} (${labels}) ---`);

          for (const s of fileSections) {
            if (s.type === "file") {
              // File section = imports
              if (s.source.trim()) parts.push(s.source);
            } else {
              const lineInfo = s.lines ? `:${s.lines.start}-${s.lines.end}` : "";
              parts.push(`// ${s.type} ${s.name}${lineInfo} [${s.relationship}]`);
              parts.push(s.source);
            }
            parts.push("");
          }
        }

        return parts.join("\n").trim();
      }

      const api: PromptAPI = { build };
      ctx.prompt = api;

      // Listen for scanner events to track the base directory
      ctx.on?.("scanner:complete", (summary: any) => {
        // The scanner doesn't emit the dir directly, but we store it
        // when the scan tool is called.
      });

      ctx.registerTool(
        "prompt_build",
        "Build a minimal LLM prompt for a symbol. Extracts the focus function/class, its dependencies, callers, and referenced types from the graph, reads only the relevant source lines, and formats them as a compact context window.",
        {
          type: "object",
          required: ["symbol"],
          properties: {
            symbol: { type: "string", description: "Symbol name or node ID (e.g. 'validate' or 'utils/validate.ts:validate')" },
            baseDir: { type: "string", description: "Base directory for resolving source files (the directory that was scanned)" },
            callers: { type: "boolean", description: "Include callers (default true)" },
            deps: { type: "boolean", description: "Include dependencies (default true)" },
            types: { type: "boolean", description: "Include types/interfaces (default true)" },
            imports: { type: "boolean", description: "Include file imports section (default true)" },
            maxDepth: { type: "number", description: "Max depth for dependency traversal (default 1)" },
            maxTokens: { type: "number", description: "Approximate token budget (default 4000)" },
            context: { type: "number", description: "Extra context lines before/after functions (default 0)" },
          },
        },
        async (args) => {
          return build(args.symbol as string, {
            baseDir: args.baseDir as string | undefined,
            callers: args.callers as boolean | undefined,
            deps: args.deps as boolean | undefined,
            types: args.types as boolean | undefined,
            imports: args.imports as boolean | undefined,
            maxDepth: args.maxDepth as number | undefined,
            maxTokens: args.maxTokens as number | undefined,
            context: args.context as number | undefined,
          });
        }
      );
    },
  } satisfies ModuleMetadata;
}
