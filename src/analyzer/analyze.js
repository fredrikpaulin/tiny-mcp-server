// Orchestrator — runs parser + all analysis modules on files/directories

import { parseModule } from './parser.js';
import { mergeAsts } from './ast.js';
import { createSymbolTable, registerModule, registerImports } from './analysis/symbols.js';
import { createCallGraph, buildCallGraph, markEntryPoints, computeReachability } from './analysis/callgraph.js';
import { analyzeComplexity, getWarnings } from './analysis/complexity.js';
import { detectDeadCode } from './analysis/deadcode.js';
import { detectSecurityIssues } from './analysis/security.js';
import { detectAsyncIssues } from './analysis/async.js';
import { extractRoutes } from './analysis/routes.js';
import { detectReactPatterns } from './analysis/react.js';
import { detectPerformanceIssues } from './analysis/performance.js';
import { detectValidation } from './analysis/validation.js';
import { detectDuplicates } from './analysis/duplicates.js';
import { detectPatterns } from './analysis/patterns.js';
import { detectDI } from './analysis/di.js';
import { buildDepGraph, detectCycles } from './analysis/depgraph.js';
import { analyzeTypeCoverage } from './analysis/typecoverage.js';
import { analyzeTestCorrelation } from './analysis/testcorr.js';
import { detectWorkspace } from './analysis/monorepo.js';

const SKIP_DIRS = ['node_modules', 'dist', 'build', '.next', 'coverage', '.git', '__pycache__'];
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];
const MAX_FILE_SIZE = 500_000; // 500KB

// Analyze a single file
export const analyzeFile = async (path) => {
  const file = Bun.file(path);
  if (!await file.exists()) return { success: false, error: `Not found: ${path}` };

  const size = file.size;
  if (size > MAX_FILE_SIZE) return { success: false, error: `File too large: ${size} bytes` };

  const source = await file.text();
  const { ast, module, hadError, errorMsg } = parseModule(source, path);

  const st = createSymbolTable();
  registerModule(st, ast, module.id);
  registerImports(st, ast, module.id);

  const cg = createCallGraph();
  buildCallGraph(cg, ast, st);
  markEntryPoints(cg, ast, st);
  computeReachability(cg);

  return {
    success: true,
    data: {
      path,
      parseError: hadError ? errorMsg : null,
      structure: {
        functions: ast.functions.length,
        classes: ast.classes.length,
        imports: ast.imports.length,
        exports: ast.exports.length,
        variables: ast.variables.length,
        interfaces: ast.interfaces.length,
        typeAliases: ast.typeAliases.length,
      },
      complexity: analyzeComplexity(ast),
      security: detectSecurityIssues(ast),
      async: detectAsyncIssues(ast),
      routes: extractRoutes(ast),
      react: detectReactPatterns(ast),
      performance: detectPerformanceIssues(ast),
      validation: detectValidation(ast),
      patterns: detectPatterns(ast),
      typeCoverage: analyzeTypeCoverage(ast),
    },
  };
};

// Discover JS/TS files in a directory
const discoverFiles = async (dir) => {
  const glob = new Bun.Glob('**/*.{ts,tsx,js,jsx}');
  const files = [];
  for await (const path of glob.scan({ cwd: dir, absolute: true })) {
    if (SKIP_DIRS.some(skip => path.includes(`/${skip}/`))) continue;
    files.push(path);
  }
  return files;
};

// Analyze an entire directory
export const analyzeDirectory = async (dir, opts = {}) => {
  const analyses = opts.analyses ?? 'all';
  let files;
  try { files = await discoverFiles(dir); } catch (e) {
    return { success: false, error: `Cannot scan directory: ${e.message}` };
  }

  if (files.length === 0) return { success: false, error: `No JS/TS files found in ${dir}` };

  // Parse all files
  const parses = [];
  const errors = [];
  const t0 = performance.now();

  for (const path of files) {
    try {
      const file = Bun.file(path);
      if (file.size > MAX_FILE_SIZE) { errors.push(`Skipped (too large): ${path}`); continue; }
      const source = await file.text();
      const result = parseModule(source, path);
      parses.push(result);
      if (result.hadError) errors.push(`Parse error in ${path}: ${result.errorMsg}`);
    } catch (e) {
      errors.push(`Failed to read ${path}: ${e.message}`);
    }
  }

  // Merge all ASTs into one (with ID remapping)
  if (parses.length === 0) return { success: false, error: 'No files could be parsed' };

  const ast = mergeAsts(parses.map(p => p.ast));

  const parseTime = performance.now() - t0;

  // Build cross-module analysis structures
  const st = createSymbolTable();
  for (const mod of ast.modules) { registerModule(st, ast, mod.id); registerImports(st, ast, mod.id); }

  const cg = createCallGraph();
  buildCallGraph(cg, ast, st);
  markEntryPoints(cg, ast, st);
  computeReachability(cg);

  // Run analyses
  const all = analyses === 'all';
  const data = {
    files: files.length,
    parsed: parses.length,
    parseErrors: errors,
    parseTimeMs: Math.round(parseTime),
    structure: {
      modules: ast.modules.length,
      functions: ast.functions.length,
      classes: ast.classes.length,
      imports: ast.imports.length,
      exports: ast.exports.length,
    },
  };

  if (all || analyses.includes('complexity')) data.complexity = analyzeComplexity(ast);
  if (all || analyses.includes('deadcode')) data.deadCode = detectDeadCode(ast, st, cg);
  if (all || analyses.includes('security')) data.security = detectSecurityIssues(ast);
  if (all || analyses.includes('async')) data.async = detectAsyncIssues(ast);
  if (all || analyses.includes('routes')) data.routes = extractRoutes(ast);
  if (all || analyses.includes('react')) data.react = detectReactPatterns(ast);
  if (all || analyses.includes('performance')) data.performance = detectPerformanceIssues(ast);
  if (all || analyses.includes('validation')) data.validation = detectValidation(ast);
  if (all || analyses.includes('duplicates')) data.duplicates = detectDuplicates(ast);
  if (all || analyses.includes('patterns')) data.patterns = detectPatterns(ast);
  if (all || analyses.includes('di')) data.di = detectDI(ast);
  if (all || analyses.includes('depgraph')) {
    const graph = buildDepGraph(ast, st);
    data.depGraph = { ...graph, cycles: detectCycles(ast, graph) };
  }
  if (all || analyses.includes('typecoverage')) data.typeCoverage = analyzeTypeCoverage(ast);
  if (all || analyses.includes('testcorr')) data.testCorrelation = analyzeTestCorrelation(ast);
  if (all || analyses.includes('monorepo')) data.monorepo = detectWorkspace(ast);

  return { success: true, data };
};

// Streaming variant — calls emit(step, key, result) after each analysis completes
// This lets the TUI render output progressively as each step finishes.
export const analyzeDirectoryStreaming = async (dir, emit, opts = {}) => {
  const analyses = opts.analyses ?? 'all';
  const all = analyses === 'all';
  const want = (name) => all || analyses.includes(name);

  // Discovery
  let files;
  try { files = await discoverFiles(dir); } catch (e) {
    return { success: false, error: `Cannot scan directory: ${e.message}` };
  }
  if (files.length === 0) return { success: false, error: `No JS/TS files found in ${dir}` };

  emit('scan', null, { files: files.length, path: dir });

  // Parse
  const parses = [];
  const errors = [];
  const t0 = performance.now();

  for (let i = 0; i < files.length; i++) {
    const path = files[i];
    try {
      const file = Bun.file(path);
      if (file.size > MAX_FILE_SIZE) { errors.push(`Skipped (too large): ${path}`); continue; }
      const source = await file.text();
      const result = parseModule(source, path);
      parses.push(result);
      if (result.hadError) errors.push(`Parse error in ${path}: ${result.errorMsg}`);
    } catch (e) {
      errors.push(`Failed to read ${path}: ${e.message}`);
    }
    if (i % 10 === 0 || i === files.length - 1) {
      emit('parsing', null, { current: i + 1, total: files.length, file: path });
    }
  }

  if (parses.length === 0) return { success: false, error: 'No files could be parsed' };

  // Merge ASTs
  const ast = mergeAsts(parses.map(p => p.ast));

  const parseTime = performance.now() - t0;
  emit('parsed', null, { parsed: parses.length, errors: errors.length, ms: Math.round(parseTime) });

  // Structure overview
  const structure = {
    modules: ast.modules.length, functions: ast.functions.length, classes: ast.classes.length,
    imports: ast.imports.length, exports: ast.exports.length,
  };
  emit('step', 'structure', structure);

  // Build symbol table
  emit('step', 'symbols', 'Building symbol table...');
  const st = createSymbolTable();
  for (const mod of ast.modules) { registerModule(st, ast, mod.id); registerImports(st, ast, mod.id); }

  // Call graph
  emit('step', 'callgraph', 'Building call graph...');
  const cg = createCallGraph();
  buildCallGraph(cg, ast, st);
  markEntryPoints(cg, ast, st);
  computeReachability(cg);

  // Run each analysis and emit as it completes
  const data = { files: files.length, parsed: parses.length, parseErrors: errors,
    parseTimeMs: Math.round(parseTime), structure };

  const step = (name, label, fn) => {
    if (!want(name)) return;
    emit('step', name, label);
    const result = fn();
    data[name] = result;
    emit('result', name, result);
  };

  step('react', 'Detecting React patterns...', () => detectReactPatterns(ast));
  step('deadCode', 'Detecting dead code...', () => detectDeadCode(ast, st, cg));
  step('security', 'Scanning for security issues...', () => detectSecurityIssues(ast));
  step('complexity', 'Calculating complexity metrics...', () => analyzeComplexity(ast));
  step('async', 'Checking async error handling...', () => detectAsyncIssues(ast));
  step('routes', 'Detecting API routes...', () => extractRoutes(ast));
  step('performance', 'Detecting performance patterns...', () => detectPerformanceIssues(ast));
  step('validation', 'Finding validation patterns...', () => detectValidation(ast));
  step('duplicates', 'Finding duplicate code...', () => detectDuplicates(ast));
  step('patterns', 'Detecting code patterns...', () => detectPatterns(ast));
  step('di', 'Finding dependency injection...', () => detectDI(ast));
  if (want('depgraph')) {
    emit('step', 'depgraph', 'Building dependency graph...');
    const graph = buildDepGraph(ast, st);
    data.depGraph = { ...graph, cycles: detectCycles(ast, graph) };
    emit('result', 'depGraph', data.depGraph);
  }
  step('typeCoverage', 'Calculating type coverage...', () => analyzeTypeCoverage(ast));
  step('testCorrelation', 'Correlating tests...', () => analyzeTestCorrelation(ast));
  step('monorepo', 'Analyzing monorepo structure...', () => detectWorkspace(ast));

  emit('done', null, data);
  return { success: true, data };
};
