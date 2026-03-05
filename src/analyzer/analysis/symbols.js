// Symbol table — ported from Skeleton-ts src/analysis/symbols.c
// Registers symbols (functions, classes, vars, interfaces, types) per module
// Resolves imports across modules via path resolution

import {
  FUNC_EXPORTED, FUNC_DEFAULT, FUNC_ARROW,
  CLASS_EXPORTED, CLASS_DEFAULT,
  VAR_EXPORTED,
} from '../ast.js';

// Symbol kinds
export const SYM_FUNCTION  = 0;
export const SYM_CLASS     = 1;
export const SYM_VARIABLE  = 2;
export const SYM_INTERFACE = 3;
export const SYM_TYPE      = 4;

export const createSymbolTable = () => ({
  byName: new Map(),           // name → Symbol
  exports: new Map(),          // "modulePath:name" → Symbol
  moduleSymbols: new Map(),    // moduleId → Symbol[]
  moduleImports: new Map(),    // moduleId → ImportBinding[]
  modulePathToId: new Map(),   // filePath → moduleId
});

const createSymbol = (name, kind, nodeId, moduleId, isExported, isDefault) => ({
  name, kind, nodeId, moduleId,
  useCount: 0,
  isExported: isExported ?? false,
  isDefaultExport: isDefault ?? false,
});

// Register all symbols from a module's AST
export const registerModule = (st, ast, moduleId) => {
  const mod = ast.modules.find(m => m.id === moduleId);
  if (!mod) return;

  const syms = [];
  const addSym = (sym) => {
    st.byName.set(sym.name, sym);
    if (sym.isExported) st.exports.set(`${mod.path}:${sym.name}`, sym);
    syms.push(sym);
  };

  // Functions
  for (const fid of mod.functions) {
    const fn = ast.functions.find(f => f.id === fid);
    if (!fn || !fn.name) continue;
    addSym(createSymbol(fn.name, SYM_FUNCTION, fn.id, moduleId,
      !!(fn.flags & FUNC_EXPORTED), !!(fn.flags & FUNC_DEFAULT)));
  }

  // Classes
  for (const cid of mod.classes) {
    const cls = ast.classes.find(c => c.id === cid);
    if (!cls || !cls.name) continue;
    addSym(createSymbol(cls.name, SYM_CLASS, cls.id, moduleId,
      !!(cls.flags & CLASS_EXPORTED), !!(cls.flags & CLASS_DEFAULT)));
  }

  // Variables
  for (const vid of mod.variables) {
    const v = ast.variables.find(vr => vr.id === vid);
    if (!v || !v.name) continue;
    addSym(createSymbol(v.name, SYM_VARIABLE, v.id, moduleId,
      !!(v.flags & VAR_EXPORTED), false));
  }

  // Interfaces
  for (const iid of mod.interfaces) {
    const iface = ast.interfaces.find(i => i.id === iid);
    if (!iface || !iface.name) continue;
    addSym(createSymbol(iface.name, SYM_INTERFACE, iface.id, moduleId, false, false));
  }

  // Type aliases
  for (const tid of mod.typeAliases) {
    const ta = ast.typeAliases.find(t => t.id === tid);
    if (!ta || !ta.name) continue;
    addSym(createSymbol(ta.name, SYM_TYPE, ta.id, moduleId, false, false));
  }

  st.moduleSymbols.set(moduleId, syms);
  st.modulePathToId.set(mod.path, moduleId);
};

// Register imports for a module
export const registerImports = (st, ast, moduleId) => {
  const mod = ast.modules.find(m => m.id === moduleId);
  if (!mod) return;

  const bindings = [];
  for (const iid of mod.imports) {
    const imp = ast.imports.find(i => i.id === iid);
    if (!imp) continue;
    for (const spec of imp.specifiers) {
      bindings.push({
        localName: spec.local,
        sourceModule: imp.source,
        importedName: spec.imported || '',
        isDefault: spec.isDefault ?? false,
        isNamespace: spec.isNamespace ?? false,
        moduleId,
      });
    }
  }
  st.moduleImports.set(moduleId, bindings);
};

// Resolve an import source path to a module ID
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js', ''];

export const resolveImportPath = (st, ast, fromModuleId, importSource) => {
  // Non-relative: direct lookup
  if (!importSource.startsWith('.')) {
    return st.modulePathToId.get(importSource) ?? 0;
  }

  // Relative: resolve from source module's directory
  const fromMod = ast.modules.find(m => m.id === fromModuleId);
  if (!fromMod) return 0;

  const fromPath = fromMod.path;
  const lastSlash = fromPath.lastIndexOf('/');
  const dir = lastSlash >= 0 ? fromPath.slice(0, lastSlash) : '.';

  // Naive path resolution
  const parts = dir.split('/');
  for (const seg of importSource.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  const resolved = parts.join('/');

  // Try extensions
  for (const ext of EXTENSIONS) {
    const candidate = resolved + ext;
    const id = st.modulePathToId.get(candidate);
    if (id) return id;
  }

  return 0;
};

// Resolve a name through imports
export const resolveSymbol = (st, moduleId, name, ast) => {
  // Check local module symbols first
  const locals = st.moduleSymbols.get(moduleId);
  if (locals) {
    const local = locals.find(s => s.name === name);
    if (local) return local;
  }

  // Check imports
  const imports = st.moduleImports.get(moduleId);
  if (imports) {
    for (const binding of imports) {
      if (binding.localName !== name) continue;

      const targetModuleId = resolveImportPath(st, ast, moduleId, binding.sourceModule);
      if (!targetModuleId) continue;

      const targetMod = ast.modules.find(m => m.id === targetModuleId);
      if (!targetMod) continue;

      if (binding.isDefault) {
        // Look for default export
        const key = `${targetMod.path}:default`;
        const sym = st.exports.get(key);
        if (sym) return sym;
        // Fall back: look for any default-exported symbol
        const targetSyms = st.moduleSymbols.get(targetModuleId) ?? [];
        const defaultSym = targetSyms.find(s => s.isDefaultExport);
        if (defaultSym) return defaultSym;
      } else {
        const importedName = binding.importedName || binding.localName;
        const key = `${targetMod.path}:${importedName}`;
        return st.exports.get(key) ?? null;
      }
    }
  }

  // Global fallback
  return st.byName.get(name) ?? null;
};

// Lookup by name (simple)
export const lookupSymbol = (st, name) => st.byName.get(name) ?? null;

// Lookup exported symbol
export const lookupExport = (st, modulePath, name) => st.exports.get(`${modulePath}:${name}`) ?? null;

// Get module symbols
export const getModuleSymbols = (st, moduleId) => st.moduleSymbols.get(moduleId) ?? [];

// Get module imports
export const getModuleImports = (st, moduleId) => st.moduleImports.get(moduleId) ?? [];
