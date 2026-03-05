// AST node types and storage — ported from Skeleton-ts src/parser/ast.h/ast.c

// --- Function flags (bitmask) ---
export const FUNC_ASYNC        = 1 << 0;
export const FUNC_GENERATOR    = 1 << 1;
export const FUNC_EXPORTED     = 1 << 2;
export const FUNC_DEFAULT      = 1 << 3;
export const FUNC_ARROW        = 1 << 4;
export const FUNC_METHOD       = 1 << 5;
export const FUNC_STATIC       = 1 << 6;
export const FUNC_PRIVATE      = 1 << 7;
export const FUNC_PROTECTED    = 1 << 8;
export const FUNC_PUBLIC       = 1 << 9;
export const FUNC_ABSTRACT     = 1 << 10;
export const FUNC_GETTER       = 1 << 11;
export const FUNC_SETTER       = 1 << 12;
export const FUNC_HASH_PRIVATE = 1 << 13;

// --- Class flags ---
export const CLASS_EXPORTED = 1 << 0;
export const CLASS_DEFAULT  = 1 << 1;
export const CLASS_ABSTRACT = 1 << 2;

// --- Variable flags ---
export const VAR_CONST    = 1 << 0;
export const VAR_LET      = 1 << 1;
export const VAR_EXPORTED = 1 << 2;

// --- Side effect types ---
export const EFFECT_NONE     = 0;
export const EFFECT_DB_READ  = 1;
export const EFFECT_DB_WRITE = 2;
export const EFFECT_FILE_READ  = 3;
export const EFFECT_FILE_WRITE = 4;
export const EFFECT_NETWORK  = 5;
export const EFFECT_CONSOLE  = 6;
export const EFFECT_PROCESS  = 7;
export const EFFECT_DOM      = 8;
export const EFFECT_STORAGE  = 9;

// --- Storage ---

export const createStorage = () => ({
  modules: [],
  functions: [],
  classes: [],
  imports: [],
  exports: [],
  variables: [],
  calls: [],
  sideEffects: [],
  tryCatches: [],
  interfaces: [],
  typeAliases: [],
  dynamicImports: [],
  _nextId: 1,
});

// --- Allocators (return the new node) ---

export const addModule = (st, path) => {
  const node = {
    id: st._nextId++, path,
    imports: [], exports: [], functions: [], classes: [],
    variables: [], interfaces: [], typeAliases: [], calls: [],
    identifierRefs: [],
    hasModuleSideEffects: false,
  };
  st.modules.push(node);
  return node;
};

export const addFunction = (st, props) => {
  const node = {
    id: st._nextId++,
    name: props.name ?? '',
    loc: props.loc ?? { line: 0, column: 0, offset: 0, length: 0 },
    flags: props.flags ?? 0,
    params: props.params ?? [],
    returnType: props.returnType ?? '',
    typeParams: props.typeParams ?? [],
    decorators: props.decorators ?? [],
    calls: [],
    sideEffects: [],
    tryCatches: [],
    lineCount: 0,
    complexity: 1,  // base cyclomatic
    cognitive: 0,
    maxNesting: 0,
    loopCount: 0,
    parentClass: props.parentClass ?? 0,
    module: props.module ?? 0,
    containingFunc: props.containingFunc ?? 0,
  };
  st.functions.push(node);
  return node;
};

export const addClass = (st, props) => {
  const node = {
    id: st._nextId++,
    name: props.name ?? '',
    loc: props.loc ?? { line: 0, column: 0, offset: 0, length: 0 },
    flags: props.flags ?? 0,
    extends: props.extends ?? '',
    implements: props.implements ?? [],
    typeParams: props.typeParams ?? [],
    decorators: props.decorators ?? [],
    methods: [],
    properties: [],
    constructor: 0,
    module: props.module ?? 0,
  };
  st.classes.push(node);
  return node;
};

export const addImport = (st, props) => {
  const node = {
    id: st._nextId++,
    loc: props.loc ?? { line: 0, column: 0, offset: 0, length: 0 },
    source: props.source ?? '',
    specifiers: props.specifiers ?? [],
    isTypeOnly: props.isTypeOnly ?? false,
    module: props.module ?? 0,
  };
  st.imports.push(node);
  return node;
};

export const addExport = (st, props) => {
  const node = {
    id: st._nextId++,
    loc: props.loc ?? { line: 0, column: 0, offset: 0, length: 0 },
    source: props.source ?? '',
    specifiers: props.specifiers ?? [],
    declaration: props.declaration ?? 0,
    isTypeOnly: props.isTypeOnly ?? false,
    isDefault: props.isDefault ?? false,
    isAll: props.isAll ?? false,
    module: props.module ?? 0,
  };
  st.exports.push(node);
  return node;
};

export const addVariable = (st, props) => {
  const node = {
    id: st._nextId++,
    name: props.name ?? '',
    typeAnnotation: props.typeAnnotation ?? '',
    loc: props.loc ?? { line: 0, column: 0, offset: 0, length: 0 },
    flags: props.flags ?? 0,
    module: props.module ?? 0,
  };
  st.variables.push(node);
  return node;
};

export const addCall = (st, props) => {
  const node = {
    id: st._nextId++,
    loc: props.loc ?? { line: 0, column: 0, offset: 0, length: 0 },
    callee: props.callee ?? '',
    fullChain: props.fullChain ?? '',
    firstArg: props.firstArg ?? '',
    containingFunc: props.containingFunc ?? 0,
    module: props.module ?? 0,
    isNew: props.isNew ?? false,
    isAwait: props.isAwait ?? false,
  };
  st.calls.push(node);
  return node;
};

export const addSideEffect = (st, props) => {
  const node = {
    id: st._nextId++,
    loc: props.loc ?? { line: 0, column: 0, offset: 0, length: 0 },
    type: props.type ?? EFFECT_NONE,
    apiCall: props.apiCall ?? '',
    containingFunc: props.containingFunc ?? 0,
  };
  st.sideEffects.push(node);
  return node;
};

export const addTryCatch = (st, props) => {
  const node = {
    id: st._nextId++,
    loc: props.loc ?? { line: 0, column: 0, offset: 0, length: 0 },
    containingFunc: props.containingFunc ?? 0,
    hasCatch: props.hasCatch ?? false,
    hasFinally: props.hasFinally ?? false,
    catchIsEmpty: props.catchIsEmpty ?? false,
    catchParam: props.catchParam ?? '',
  };
  st.tryCatches.push(node);
  return node;
};

export const addInterface = (st, props) => {
  const node = {
    id: st._nextId++,
    name: props.name ?? '',
    loc: props.loc ?? { line: 0, column: 0, offset: 0, length: 0 },
    extends: props.extends ?? [],
    typeParams: props.typeParams ?? [],
    properties: [],
    methods: [],
    module: props.module ?? 0,
  };
  st.interfaces.push(node);
  return node;
};

export const addTypeAlias = (st, props) => {
  const node = {
    id: st._nextId++,
    name: props.name ?? '',
    definition: props.definition ?? '',
    loc: props.loc ?? { line: 0, column: 0, offset: 0, length: 0 },
    typeParams: props.typeParams ?? [],
    module: props.module ?? 0,
  };
  st.typeAliases.push(node);
  return node;
};

export const addDynamicImport = (st, props) => {
  const node = {
    id: st._nextId++,
    loc: props.loc ?? { line: 0, column: 0, offset: 0, length: 0 },
    source: props.source ?? '',
    isResolvable: props.isResolvable ?? false,
    expression: props.expression ?? '',
    containingFunc: props.containingFunc ?? 0,
    module: props.module ?? 0,
  };
  st.dynamicImports.push(node);
  return node;
};

// --- Merge multiple per-file ASTs into one with globally unique IDs ---

export const mergeAsts = (asts) => {
  const merged = createStorage();
  let offset = 0;

  for (const ast of asts) {
    // Find max id in this AST to compute offset for next AST
    let maxId = 0;
    const scan = (arr) => { for (const n of arr) { if (n.id > maxId) maxId = n.id; } };
    scan(ast.modules); scan(ast.functions); scan(ast.classes); scan(ast.imports);
    scan(ast.exports); scan(ast.variables); scan(ast.calls); scan(ast.sideEffects);
    scan(ast.tryCatches); scan(ast.interfaces); scan(ast.typeAliases); scan(ast.dynamicImports);

    const remap = (id) => id === 0 ? 0 : id + offset;
    const remapArr = (arr) => arr.map(remap);

    for (const m of ast.modules) merged.modules.push({
      ...m, id: remap(m.id),
      imports: remapArr(m.imports), exports: remapArr(m.exports),
      functions: remapArr(m.functions), classes: remapArr(m.classes),
      variables: remapArr(m.variables), interfaces: remapArr(m.interfaces),
      typeAliases: remapArr(m.typeAliases), calls: remapArr(m.calls),
    });
    for (const f of ast.functions) merged.functions.push({
      ...f, id: remap(f.id), module: remap(f.module),
      parentClass: f.parentClass ? remap(f.parentClass) : 0,
      containingFunc: f.containingFunc ? remap(f.containingFunc) : 0,
      calls: remapArr(f.calls), sideEffects: remapArr(f.sideEffects),
      tryCatches: remapArr(f.tryCatches),
    });
    for (const c of ast.classes) merged.classes.push({
      ...c, id: remap(c.id), module: remap(c.module),
      methods: remapArr(c.methods), constructor: c.constructor ? remap(c.constructor) : 0,
    });
    for (const i of ast.imports) merged.imports.push({
      ...i, id: remap(i.id), module: remap(i.module),
    });
    for (const e of ast.exports) merged.exports.push({
      ...e, id: remap(e.id), module: remap(e.module),
      declaration: e.declaration ? remap(e.declaration) : 0,
    });
    for (const v of ast.variables) merged.variables.push({
      ...v, id: remap(v.id), module: remap(v.module),
    });
    for (const c of ast.calls) merged.calls.push({
      ...c, id: remap(c.id), module: remap(c.module),
      containingFunc: c.containingFunc ? remap(c.containingFunc) : 0,
    });
    for (const s of ast.sideEffects) merged.sideEffects.push({
      ...s, id: remap(s.id), containingFunc: s.containingFunc ? remap(s.containingFunc) : 0,
    });
    for (const t of ast.tryCatches) merged.tryCatches.push({
      ...t, id: remap(t.id), containingFunc: t.containingFunc ? remap(t.containingFunc) : 0,
    });
    for (const i of ast.interfaces) merged.interfaces.push({
      ...i, id: remap(i.id), module: remap(i.module),
    });
    for (const t of ast.typeAliases) merged.typeAliases.push({
      ...t, id: remap(t.id), module: remap(t.module),
    });
    for (const d of ast.dynamicImports) merged.dynamicImports.push({
      ...d, id: remap(d.id), module: remap(d.module),
      containingFunc: d.containingFunc ? remap(d.containingFunc) : 0,
    });

    offset += maxId;
  }

  merged._nextId = offset + 1;
  return merged;
};

// --- Getters (by id, cached via WeakMap) ---

const indexCache = new WeakMap();
const findById = (arr, id) => {
  let index = indexCache.get(arr);
  if (!index) {
    index = new Map();
    for (let i = 0; i < arr.length; i++) index.set(arr[i].id, arr[i]);
    indexCache.set(arr, index);
  }
  return index.get(id) ?? null;
};

export const getModule = (st, id) => findById(st.modules, id);
export const getFunction = (st, id) => findById(st.functions, id);
export const getClass = (st, id) => findById(st.classes, id);
export const getImport = (st, id) => findById(st.imports, id);
export const getExport = (st, id) => findById(st.exports, id);
export const getVariable = (st, id) => findById(st.variables, id);
export const getCall = (st, id) => findById(st.calls, id);
export const getSideEffect = (st, id) => findById(st.sideEffects, id);
export const getTryCatch = (st, id) => findById(st.tryCatches, id);
export const getInterface = (st, id) => findById(st.interfaces, id);
export const getTypeAlias = (st, id) => findById(st.typeAliases, id);
export const getDynamicImport = (st, id) => findById(st.dynamicImports, id);
