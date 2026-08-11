// Type contract for the JS analyzer AST (ast.js).
// The parser is plain JS for speed and portability; this declaration gives
// the TypeScript consumers (scanner, prompt, tests) a real contract to check
// against instead of inferring `never` from empty-array initializers.

export interface Loc {
  line: number;
  column: number;
  offset: number;
  length: number;
}

export interface Param {
  name: string;
  typeAnnotation?: string;
  optional?: boolean;
  rest?: boolean;
  default?: string;
}

export interface Decorator {
  name?: string;
  fullName?: string;
  args?: string[];
}

export interface FunctionNode {
  id: number;
  name: string;
  loc: Loc;
  flags: number;
  params: Param[];
  returnType: string;
  typeParams: string[];
  decorators: Decorator[];
  calls: number[];
  sideEffects: number[];
  tryCatches: number[];
  lineCount: number;
  complexity: number;
  cognitive: number;
  maxNesting: number;
  loopCount: number;
  parentClass: number;
  module: number;
  containingFunc: number;
}

export interface ClassNode {
  id: number;
  name: string;
  loc: Loc;
  flags: number;
  extends: string;
  implements: string[];
  typeParams: string[];
  decorators: Decorator[];
  methods: number[];
  properties: number[];
  constructor: number;
  module: number;
}

export interface ImportSpecifier {
  local?: string;
  imported?: string;
}

export interface ImportNode {
  id: number;
  loc: Loc;
  source: string;
  specifiers: ImportSpecifier[];
  isTypeOnly: boolean;
  module: number;
}

export interface ExportNode {
  id: number;
  loc: Loc;
  source: string;
  specifiers: ImportSpecifier[];
  declaration: number;
  isTypeOnly: boolean;
  isDefault: boolean;
  isAll: boolean;
  module: number;
}

export interface VariableNode {
  id: number;
  name: string;
  typeAnnotation: string;
  loc: Loc;
  flags: number;
  module: number;
}

export interface CallNode {
  id: number;
  loc: Loc;
  callee: string;
  fullChain: string;
  firstArg: string;
  containingFunc: number;
  module: number;
  isNew: boolean;
  isAwait: boolean;
}

export interface SideEffectNode {
  id: number;
  loc: Loc;
  type: number;
  apiCall: string;
  containingFunc: number;
}

export interface TryCatchNode {
  id: number;
  loc: Loc;
  containingFunc: number;
  hasCatch: boolean;
  hasFinally: boolean;
  catchIsEmpty: boolean;
  catchParam: string;
}

export interface InterfaceNode {
  id: number;
  name: string;
  loc: Loc;
  extends: string[];
  typeParams: string[];
  properties: number[];
  methods: number[];
  module: number;
}

export interface TypeAliasNode {
  id: number;
  name: string;
  definition: string;
  loc: Loc;
  typeParams: string[];
  module: number;
}

export interface DynamicImportNode {
  id: number;
  loc: Loc;
  source: string;
  isResolvable: boolean;
  expression: string;
  containingFunc: number;
  module: number;
}

export interface ModuleNode {
  id: number;
  path: string;
  imports: number[];
  exports: number[];
  functions: number[];
  classes: number[];
  variables: number[];
  interfaces: number[];
  typeAliases: number[];
  calls: number[];
  identifierRefs: number[];
  hasModuleSideEffects: boolean;
}

export interface Ast {
  modules: ModuleNode[];
  functions: FunctionNode[];
  classes: ClassNode[];
  imports: ImportNode[];
  exports: ExportNode[];
  variables: VariableNode[];
  calls: CallNode[];
  sideEffects: SideEffectNode[];
  tryCatches: TryCatchNode[];
  interfaces: InterfaceNode[];
  typeAliases: TypeAliasNode[];
  dynamicImports: DynamicImportNode[];
  _nextId: number;
}

// --- Function flags (bitmask) ---
export const FUNC_ASYNC: number;
export const FUNC_GENERATOR: number;
export const FUNC_EXPORTED: number;
export const FUNC_DEFAULT: number;
export const FUNC_ARROW: number;
export const FUNC_METHOD: number;
export const FUNC_STATIC: number;
export const FUNC_PRIVATE: number;
export const FUNC_PROTECTED: number;
export const FUNC_PUBLIC: number;
export const FUNC_ABSTRACT: number;
export const FUNC_GETTER: number;
export const FUNC_SETTER: number;
export const FUNC_HASH_PRIVATE: number;

// --- Class flags ---
export const CLASS_EXPORTED: number;
export const CLASS_DEFAULT: number;
export const CLASS_ABSTRACT: number;

// --- Variable flags ---
export const VAR_CONST: number;
export const VAR_LET: number;
export const VAR_EXPORTED: number;

// --- Side effect types ---
export const EFFECT_NONE: number;
export const EFFECT_DB_READ: number;
export const EFFECT_DB_WRITE: number;
export const EFFECT_FILE_READ: number;
export const EFFECT_FILE_WRITE: number;
export const EFFECT_NETWORK: number;
export const EFFECT_CONSOLE: number;
export const EFFECT_PROCESS: number;
export const EFFECT_DOM: number;
export const EFFECT_STORAGE: number;

export function createStorage(): Ast;
export function mergeAsts(asts: Ast[]): Ast;

export function getModule(st: Ast, id: number): ModuleNode | null;
export function getFunction(st: Ast, id: number): FunctionNode | null;
export function getClass(st: Ast, id: number): ClassNode | null;
export function getImport(st: Ast, id: number): ImportNode | null;
export function getExport(st: Ast, id: number): ExportNode | null;
export function getVariable(st: Ast, id: number): VariableNode | null;
export function getCall(st: Ast, id: number): CallNode | null;
export function getSideEffect(st: Ast, id: number): SideEffectNode | null;
export function getTryCatch(st: Ast, id: number): TryCatchNode | null;
export function getInterface(st: Ast, id: number): InterfaceNode | null;
export function getTypeAlias(st: Ast, id: number): TypeAliasNode | null;
export function getDynamicImport(st: Ast, id: number): DynamicImportNode | null;
