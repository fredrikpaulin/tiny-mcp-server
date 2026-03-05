// JS/TS Recursive Descent Parser — ported from Skeleton-ts src/parser/parser.c
// Extracts functions, classes, imports, exports, calls, side effects, complexity

import { createLexer } from './lexer.js';
import * as T from './tokens.js';
import {
  FUNC_ASYNC, FUNC_GENERATOR, FUNC_EXPORTED, FUNC_DEFAULT, FUNC_ARROW,
  FUNC_METHOD, FUNC_STATIC, FUNC_PRIVATE, FUNC_PROTECTED, FUNC_PUBLIC,
  FUNC_ABSTRACT, FUNC_GETTER, FUNC_SETTER, FUNC_HASH_PRIVATE,
  CLASS_EXPORTED, CLASS_DEFAULT, CLASS_ABSTRACT,
  VAR_CONST, VAR_LET, VAR_EXPORTED,
  EFFECT_NONE, EFFECT_DB_READ, EFFECT_DB_WRITE, EFFECT_FILE_READ, EFFECT_FILE_WRITE,
  EFFECT_NETWORK, EFFECT_CONSOLE, EFFECT_PROCESS, EFFECT_DOM, EFFECT_STORAGE,
  createStorage, addModule, addFunction, addClass, addImport, addExport,
  addVariable, addCall, addSideEffect, addTryCatch, addInterface, addTypeAlias,
  addDynamicImport,
} from './ast.js';

const MAX_CALLBACK_DEPTH = 50;

// --- Side effect detection ---

const checkSideEffect = (chain) => {
  if (!chain) return EFFECT_NONE;
  if (chain.includes('fs.') || chain.includes('readFile') || chain.includes('writeFile') ||
      chain.includes('appendFile') || chain.includes('unlink') || chain.includes('mkdir')) {
    return chain.includes('read') ? EFFECT_FILE_READ : EFFECT_FILE_WRITE;
  }
  if (chain.includes('fetch') || chain.includes('axios') || chain.includes('http.') || chain.includes('https.')) return EFFECT_NETWORK;
  if (chain.includes('db.') || chain.includes('prisma.') || chain.includes('mongoose.') ||
      chain.includes('.query') || chain.includes('.find') || chain.includes('.create') ||
      chain.includes('.update') || chain.includes('.delete') || chain.includes('.save')) {
    return (chain.includes('find') || chain.includes('get') || chain.includes('query') || chain.includes('select'))
      ? EFFECT_DB_READ : EFFECT_DB_WRITE;
  }
  if (chain.includes('console.')) return EFFECT_CONSOLE;
  if (chain.includes('process.') || chain.includes('child_process')) return EFFECT_PROCESS;
  if (chain.includes('document.') || chain.includes('window.') || chain.includes('getElementById') || chain.includes('querySelector')) return EFFECT_DOM;
  if (chain.includes('localStorage') || chain.includes('sessionStorage')) return EFFECT_STORAGE;
  return EFFECT_NONE;
};

// --- Builtin type check ---

const BUILTIN_TYPES = new Set([
  'any', 'void', 'null', 'true', 'never', 'false',
  'string', 'number', 'object', 'symbol', 'bigint',
  'boolean', 'unknown', 'undefined',
]);

const TYPE_KEYWORDS = new Set(['typeof', 'keyof', 'infer', 'readonly', 'extends']);

// --- Context keyword identifiers ---

const CONTEXT_KEYWORDS = new Set([
  T.TOK_IDENT, T.TOK_TYPE, T.TOK_FROM, T.TOK_AS, T.TOK_OF,
  T.TOK_GET, T.TOK_SET, T.TOK_ASYNC, T.TOK_READONLY, T.TOK_DECLARE,
  T.TOK_NAMESPACE, T.TOK_MODULE, T.TOK_INFER, T.TOK_IS, T.TOK_KEYOF,
  T.TOK_ABSTRACT, T.TOK_OVERRIDE, T.TOK_SATISFIES, T.TOK_ASSERTS,
]);

// --- Parser ---

export const parseModule = (source, filePath) => {
  const ast = createStorage();
  const lexer = createLexer(source);

  const p = {
    current: null,
    previous: null,
    prevPrev: null,
    currentModule: 0,
    currentModulePtr: null,
    currentFunction: 0,
    currentClass: 0,
    scopes: [{ locals: new Set() }],
    scopeDepth: 0,
    callbackScanDepth: 0,
    hadError: false,
    panicMode: false,
    errorMsg: '',
  };

  // --- Scope ---
  const scopeBegin = () => {
    p.scopeDepth++;
    if (!p.scopes[p.scopeDepth]) p.scopes[p.scopeDepth] = { locals: new Set() };
    else p.scopes[p.scopeDepth].locals.clear();
  };
  const scopeEnd = () => { if (p.scopeDepth > 0) p.scopeDepth--; };
  const scopeAddLocal = (name) => { p.scopes[p.scopeDepth]?.locals.add(name); };
  const scopeIsLocal = (name) => {
    // Walk from current scope down to 1 (skip scope 0 / module scope)
    // so module-level variables still get recorded as identifierRefs
    for (let d = p.scopeDepth; d >= 1; d--) {
      if (p.scopes[d]?.locals.has(name)) return true;
    }
    return false;
  };

  // --- Utilities ---
  const advance = () => {
    p.prevPrev = p.previous;
    p.previous = p.current;
    for (;;) {
      p.current = lexer.next();
      if (p.current.type === T.TOK_COMMENT || p.current.type === T.TOK_TS_IGNORE ||
          p.current.type === T.TOK_TS_EXPECT_ERROR || p.current.type === T.TOK_TS_NOCHECK) continue;
      break;
    }
  };

  const check = (type) => p.current.type === type;
  const match = (type) => { if (!check(type)) return false; advance(); return true; };
  const errorAt = (tok, msg) => {
    if (p.panicMode) return;
    p.panicMode = true;
    p.hadError = true;
    const err = `Line ${tok.line}: ${msg}`;
    p.errorMsg = p.errorMsg ? `${p.errorMsg}\n${err}` : err;
  };
  const consume = (type, msg) => { if (check(type)) { advance(); return; } errorAt(p.current, msg); };

  const makeLoc = (tok) => ({ line: tok.line, column: tok.column, offset: tok.offset, length: tok.length });

  // String value helpers
  const intern = (tok) => tok.value;
  const internString = (tok) => {
    const v = tok.value;
    if (v.length >= 2 && (v[0] === '"' || v[0] === "'" || v[0] === '`'))
      return v.slice(1, -1);
    return v;
  };

  const checkIdentOrKeyword = () => CONTEXT_KEYWORDS.has(p.current.type);
  const isPascalCase = (tok) => tok.value.length > 0 && tok.value[0] >= 'A' && tok.value[0] <= 'Z';
  const isJsxElement = (tok) => p.previous?.type === T.TOK_LT && isPascalCase(tok);
  const isJsxAttrValueStart = () => p.previous?.type === T.TOK_LBRACE && p.prevPrev?.type === T.TOK_EQ;

  // --- Skip balanced ---
  const skipBalanced = (open, close) => {
    let depth = 1;
    while (depth > 0 && !check(T.TOK_EOF)) {
      if (check(open)) depth++;
      else if (check(close)) depth--;
      advance();
    }
  };

  // --- Synchronize ---
  const synchronize = () => {
    p.panicMode = false;
    while (!check(T.TOK_EOF)) {
      if (p.previous?.type === T.TOK_SEMI) return;
      switch (p.current.type) {
        case T.TOK_IMPORT: case T.TOK_EXPORT: case T.TOK_FUNCTION: case T.TOK_CLASS:
        case T.TOK_CONST: case T.TOK_LET: case T.TOK_VAR: case T.TOK_IF:
        case T.TOK_FOR: case T.TOK_WHILE: case T.TOK_RETURN: case T.TOK_INTERFACE:
        case T.TOK_TYPE: return;
      }
      advance();
    }
  };

  // --- Generic > morphing ---
  const isClosingGt = () => check(T.TOK_GT) || check(T.TOK_GTGT) || check(T.TOK_GTGTGT);
  const gtDepth = () => {
    if (check(T.TOK_GT)) return 1;
    if (check(T.TOK_GTGT)) return 2;
    if (check(T.TOK_GTGTGT)) return 3;
    return 0;
  };

  const consumeOneGt = () => {
    if (check(T.TOK_GT)) { advance(); }
    else if (check(T.TOK_GTGT)) {
      // Morph >> to > — adjust current token in place
      p.current = { ...p.current, type: T.TOK_GT, value: '>', offset: p.current.offset + 1, length: 1 };
    } else if (check(T.TOK_GTGTGT)) {
      p.current = { ...p.current, type: T.TOK_GTGT, value: '>>', offset: p.current.offset + 1, length: 2 };
    }
  };

  // --- Type parameters ---
  const parseTypeParams = () => {
    if (!match(T.TOK_LT)) return [];
    const params = [];
    do {
      if (isClosingGt()) break;
      if (check(T.TOK_IDENT)) {
        params.push(intern(p.current));
        advance();
        // Skip extends/default clauses with nested generic tracking
        if (match(T.TOK_EXTENDS)) {
          let depth = 0;
          while (!check(T.TOK_EOF)) {
            if (check(T.TOK_LT)) { depth++; advance(); }
            else if (isClosingGt()) {
              const gt = gtDepth();
              if (gt > depth) { while (depth > 0) { consumeOneGt(); depth--; } break; }
              depth -= gt; advance();
            } else if (check(T.TOK_COMMA) && depth === 0) break;
            else advance();
          }
        }
        if (match(T.TOK_EQ)) {
          let depth = 0;
          while (!check(T.TOK_EOF)) {
            if (check(T.TOK_LT)) { depth++; advance(); }
            else if (isClosingGt()) {
              const gt = gtDepth();
              if (gt > depth) { while (depth > 0) { consumeOneGt(); depth--; } break; }
              depth -= gt; advance();
            } else if (check(T.TOK_COMMA) && depth === 0) break;
            else advance();
          }
        }
      }
    } while (match(T.TOK_COMMA));
    if (isClosingGt()) consumeOneGt();
    return params;
  };

  // --- Type annotation ---
  const parseTypeAnnotation = () => {
    const startOffset = p.current.offset;
    let angleDepth = 0, parenDepth = 0, bracketDepth = 0, braceDepth = 0;
    let justClosedParen = false, afterUnionOrIntersection = false;

    while (!check(T.TOK_EOF)) {
      if (angleDepth === 0 && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
        if (check(T.TOK_SEMI) || check(T.TOK_COMMA) || check(T.TOK_EQ) ||
            check(T.TOK_RPAREN) || check(T.TOK_RBRACKET) || check(T.TOK_RBRACE)) break;
        if (check(T.TOK_ARROW) && !justClosedParen) break;
        if (check(T.TOK_LBRACE) && !afterUnionOrIntersection) {
          const slice = source.slice(startOffset, p.current.offset).trim();
          if (slice.length > 0) break;
        }
      }
      justClosedParen = false;
      if (check(T.TOK_PIPE) || check(T.TOK_AMP)) { afterUnionOrIntersection = true; advance(); continue; }
      afterUnionOrIntersection = false;
      if (check(T.TOK_LT)) angleDepth++;
      else if (check(T.TOK_GTGTGT)) { if (angleDepth >= 3) angleDepth -= 3; else break; }
      else if (check(T.TOK_GTGT)) { if (angleDepth >= 2) angleDepth -= 2; else break; }
      else if (check(T.TOK_GT)) { if (angleDepth > 0) angleDepth--; else break; }
      else if (check(T.TOK_LPAREN)) parenDepth++;
      else if (check(T.TOK_RPAREN)) { if (parenDepth > 0) { parenDepth--; if (parenDepth === 0) justClosedParen = true; } else break; }
      else if (check(T.TOK_LBRACKET)) bracketDepth++;
      else if (check(T.TOK_RBRACKET)) { if (bracketDepth > 0) bracketDepth--; else break; }
      else if (check(T.TOK_LBRACE)) braceDepth++;
      else if (check(T.TOK_RBRACE)) { if (braceDepth > 0) braceDepth--; else break; }
      advance();
    }
    const result = source.slice(startOffset, p.current.offset).trim();
    return result || '';
  };

  // --- Identifier ref tracking ---
  const recordIdentRef = (tok) => {
    if (!p.currentModulePtr) return;
    const name = intern(tok);
    if (scopeIsLocal(name)) return;
    p.currentModulePtr.identifierRefs.push({ name, loc: makeLoc(tok) });
  };

  // Scan template literal for ${ident} refs
  const scanTemplateRefs = (tok) => {
    const v = tok.value;
    if (v.length < 4) return;
    let i = 1; // skip opening `
    const end = v.length - 1;
    while (i < end) {
      if (v[i] === '$' && i + 1 < end && v[i + 1] === '{') {
        i += 2;
        const isIdStart = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
        const isIdChar = (c) => isIdStart(c) || (c >= '0' && c <= '9');
        if (i < end && isIdStart(v[i])) {
          const s = i;
          while (i < end && isIdChar(v[i])) i++;
          const name = v.slice(s, i);
          if (name && p.currentModulePtr && !scopeIsLocal(name)) {
            p.currentModulePtr.identifierRefs.push({ name, loc: makeLoc(tok) });
          }
        }
        let depth = 1;
        while (i < end && depth > 0) { if (v[i] === '{') depth++; else if (v[i] === '}') depth--; i++; }
      } else if (v[i] === '\\' && i + 1 < end) { i += 2; }
      else i++;
    }
  };

  // Scan type annotation string for identifier refs
  const scanTypeForRefs = (typeStr) => {
    if (!typeStr) return;
    const re = /[a-zA-Z_$][a-zA-Z0-9_$]*/g;
    let m;
    while ((m = re.exec(typeStr)) !== null) {
      const name = m[0];
      if (!BUILTIN_TYPES.has(name) && !TYPE_KEYWORDS.has(name)) {
        if (p.currentModulePtr) {
          p.currentModulePtr.identifierRefs.push({ name, loc: { line: 0, column: 0, offset: 0, length: 0 } });
        }
      }
    }
  };

  // --- Parse params ---
  const parseParams = () => {
    if (check(T.TOK_RPAREN)) return [];
    const params = [];
    do {
      const param = { name: '', typeAnnotation: '', defaultValue: '', isOptional: false, isRest: false, isDestructured: false };
      // Skip parameter decorators
      while (check(T.TOK_AT)) {
        advance();
        if (check(T.TOK_IDENT)) { advance(); if (check(T.TOK_LPAREN)) { advance(); skipBalanced(T.TOK_LPAREN, T.TOK_RPAREN); } }
      }
      if (match(T.TOK_DOTDOTDOT)) param.isRest = true;
      // TS constructor properties
      while (check(T.TOK_PRIVATE) || check(T.TOK_PUBLIC) || check(T.TOK_PROTECTED) || check(T.TOK_READONLY)) advance();
      if (checkIdentOrKeyword()) {
        param.name = intern(p.current);
        advance();
      } else if (check(T.TOK_LBRACE) || check(T.TOK_LBRACKET)) {
        const start = p.current.offset;
        let depth = 1; advance();
        while (!check(T.TOK_EOF) && depth > 0) {
          if (check(T.TOK_LBRACE) || check(T.TOK_LBRACKET)) depth++;
          else if (check(T.TOK_RBRACE) || check(T.TOK_RBRACKET)) depth--;
          advance();
        }
        param.name = source.slice(start, p.previous.offset + p.previous.length);
        param.isDestructured = true;
      } else { errorAt(p.current, 'Expected parameter name'); return params; }
      if (match(T.TOK_QUESTION)) param.isOptional = true;
      if (match(T.TOK_COLON)) param.typeAnnotation = parseTypeAnnotation();
      if (match(T.TOK_EQ)) {
        let depth = 0;
        while (!check(T.TOK_EOF)) {
          if (check(T.TOK_LPAREN) || check(T.TOK_LBRACE) || check(T.TOK_LBRACKET)) depth++;
          else if (check(T.TOK_RPAREN) || check(T.TOK_RBRACE) || check(T.TOK_RBRACKET)) { if (depth === 0) break; depth--; }
          else if (check(T.TOK_COMMA) && depth === 0) break;
          if (check(T.TOK_IDENT)) recordIdentRef(p.current);
          advance();
        }
      }
      params.push(param);
    } while (match(T.TOK_COMMA) && !check(T.TOK_RPAREN));
    return params;
  };

  // --- Record call ---
  const recordCall = (callee, fullChain, isNew, isAwait) => {
    const node = addCall(ast, {
      loc: makeLoc(p.previous), callee, fullChain,
      containingFunc: p.currentFunction, module: p.currentModule,
      isNew, isAwait,
    });
    return node;
  };

  // --- Record dynamic import ---
  const recordDynamicImport = (importTok, src, expression, isResolvable) => {
    addDynamicImport(ast, {
      loc: makeLoc(importTok), source: src ?? '', expression: expression ?? '',
      isResolvable, containingFunc: p.currentFunction, module: p.currentModule,
    });
  };

  // --- Build member chain ---
  const buildChain = (firstTok) => {
    let chain = firstTok.value;
    while ((check(T.TOK_DOT) || check(T.TOK_QUESTIONDOT)) && !check(T.TOK_EOF)) {
      chain += check(T.TOK_QUESTIONDOT) ? '?.' : '.';
      advance(); // . or ?.
      if (check(T.TOK_IDENT) || check(T.TOK_CATCH) || check(T.TOK_FINALLY) ||
          check(T.TOK_DELETE)) { chain += p.current.value; advance(); }
      else break;
    }
    return chain;
  };

  // Build member chain allowing keywords as property names (module-level)
  const buildChainWithKeywords = (firstTok) => {
    let chain = firstTok.value;
    while ((check(T.TOK_DOT) || check(T.TOK_QUESTIONDOT)) && !check(T.TOK_EOF)) {
      chain += check(T.TOK_QUESTIONDOT) ? '?.' : '.';
      advance();
      const validMember = check(T.TOK_IDENT) || check(T.TOK_GET) || check(T.TOK_SET) ||
        check(T.TOK_DELETE) || check(T.TOK_IN) || check(T.TOK_DEFAULT) || check(T.TOK_ASYNC) ||
        check(T.TOK_STATIC) || check(T.TOK_CLASS) || check(T.TOK_FUNCTION) || check(T.TOK_TYPEOF) ||
        check(T.TOK_VOID) || check(T.TOK_NEW);
      if (validMember) { chain += p.current.value; advance(); }
      else break;
    }
    return chain;
  };

  // --- Skip generic type args (heuristic) ---
  const trySkipGenericArgs = () => {
    if (!check(T.TOK_LT)) return;
    // Save lexer state for backtracking
    const savedState = { ...lexer.state };
    const savedCurrent = p.current;
    advance(); // <
    let depth = 1;
    while (depth > 0 && !check(T.TOK_EOF)) {
      if (check(T.TOK_LT)) depth++;
      else if (check(T.TOK_GT)) depth--;
      if (check(T.TOK_LBRACE) || check(T.TOK_RBRACE) || check(T.TOK_SEMI)) break;
      advance();
    }
    if (depth === 0 && check(T.TOK_LPAREN)) return; // good, at (
    // Restore
    Object.assign(lexer.state, savedState);
    p.current = savedCurrent;
  };

  // --- Scan interface body ---
  const scanInterfaceBody = () => {
    let depth = 1;
    while (depth > 0 && !check(T.TOK_EOF)) {
      if (check(T.TOK_LBRACE)) { depth++; advance(); }
      else if (check(T.TOK_RBRACE)) { depth--; if (depth > 0) advance(); }
      else if (depth === 1 && check(T.TOK_COLON)) {
        advance();
        const type = parseTypeAnnotation();
        scanTypeForRefs(type);
      } else advance();
    }
    if (check(T.TOK_RBRACE)) advance();
  };

  // --- scan_callback_args_for_func ---
  const CALLBACK_WRAPPERS = new Set([
    'useCallback', 'useEffect', 'useLayoutEffect', 'useInsertionEffect',
    'useMemo', 'setTimeout', 'setInterval', 'requestAnimationFrame',
    'then', 'catch', 'finally',
  ]);

  const scanCallbackArgs = (func, captureFirstArg, parentCallee) => {
    if (p.callbackScanDepth >= MAX_CALLBACK_DEPTH) {
      let pd = 1;
      while (pd > 0 && !check(T.TOK_EOF)) {
        if (check(T.TOK_LPAREN)) pd++;
        else if (check(T.TOK_RPAREN)) pd--;
        if (pd > 0) advance();
      }
      return null;
    }
    p.callbackScanDepth++;

    let firstArg = null;
    // Capture first argument text
    if (captureFirstArg && !check(T.TOK_RPAREN)) {
      const argStart = p.current.offset;
      // Save state
      const saved = { ...lexer.state };
      const savedTok = p.current;
      let ad = 0;
      while (!check(T.TOK_EOF)) {
        if (check(T.TOK_LPAREN) || check(T.TOK_LBRACE) || check(T.TOK_LBRACKET)) ad++;
        else if (check(T.TOK_RPAREN) || check(T.TOK_RBRACE) || check(T.TOK_RBRACKET)) { if (ad === 0) break; ad--; }
        else if (check(T.TOK_COMMA) && ad === 0) break;
        advance();
      }
      const argLen = p.current.offset - argStart;
      if (argLen > 0 && argLen < 256) firstArg = source.slice(argStart, argStart + argLen);
      Object.assign(lexer.state, saved);
      p.current = savedTok;
    }

    // If parentCallee is a callback wrapper, create a child function for the callback body
    let callTarget = func;
    if (parentCallee && CALLBACK_WRAPPERS.has(parentCallee)) {
      callTarget = addFunction(ast, {
        name: '', flags: FUNC_ARROW, loc: makeLoc(p.current),
        containingFunc: func.id, module: p.currentModule,
      });
      p.currentModulePtr.functions.push(callTarget.id);
    }

    let depth = 1;
    while (depth > 0 && !check(T.TOK_EOF)) {
      if (check(T.TOK_LPAREN)) { depth++; advance(); }
      else if (check(T.TOK_RPAREN)) { depth--; if (depth > 0) advance(); }
      else if (check(T.TOK_TEMPLATE)) { scanTemplateRefs(p.current); advance(); }
      else if (check(T.TOK_LBRACE)) {
        // Arrow/callback body with braces
        advance();
        let bd = 1;
        let cbPrevNew = false;
        while (bd > 0 && !check(T.TOK_EOF)) {
          if (check(T.TOK_NEW)) { cbPrevNew = true; advance(); continue; }
          if (check(T.TOK_LBRACE)) { bd++; advance(); cbPrevNew = false; }
          else if (check(T.TOK_RBRACE)) { bd--; if (bd > 0) advance(); cbPrevNew = false; }
          else if (check(T.TOK_IDENT)) {
            const first = p.current;
            if (isJsxElement(first)) {
              const call = recordCall(first.value, first.value, false, false);
              callTarget.calls.push(call.id); advance(); continue;
            }
            if (isJsxAttrValueStart()) {
              if (isPascalCase(first)) { const call = recordCall(first.value, first.value, false, false); callTarget.calls.push(call.id); }
              else recordIdentRef(first);
              advance(); continue;
            }
            advance();
            let fullChain = first.value;
            while ((check(T.TOK_DOT) || check(T.TOK_QUESTIONDOT)) && !check(T.TOK_EOF)) {
              fullChain += '.'; advance();
              if (check(T.TOK_IDENT) || check(T.TOK_CATCH) || check(T.TOK_FINALLY) || check(T.TOK_DELETE)) { fullChain += p.current.value; advance(); } else break;
            }
            if (check(T.TOK_LPAREN) || check(T.TOK_LT)) {
              if (check(T.TOK_LT)) trySkipGenericArgs();
              if (check(T.TOK_LPAREN)) {
                if (fullChain.length > first.value.length) recordIdentRef(first);
                const call = recordCall(first.value, fullChain, cbPrevNew, false);
                callTarget.calls.push(call.id);
                const cbEff = checkSideEffect(fullChain);
                if (cbEff !== EFFECT_NONE) {
                  const se = addSideEffect(ast, { loc: makeLoc(first), type: cbEff, apiCall: fullChain, containingFunc: callTarget.id });
                  callTarget.sideEffects.push(se.id);
                }
                const lastSeg = fullChain.includes('.') ? fullChain.split('.').pop() : fullChain;
                advance();
                scanCallbackArgs(callTarget, false, lastSeg);
              }
            } else {
              recordIdentRef(first);
            }
            cbPrevNew = false;
          } else if (check(T.TOK_TEMPLATE)) { scanTemplateRefs(p.current); advance(); }
          else { advance(); cbPrevNew = false; }
        }
      } else if (check(T.TOK_ARROW)) {
        advance(); // =>
        if (!check(T.TOK_LBRACE)) {
          // Expression body
          let ed = 0;
          while (!check(T.TOK_EOF)) {
            if (check(T.TOK_LPAREN) || check(T.TOK_LBRACE) || check(T.TOK_LBRACKET)) { ed++; advance(); }
            else if (check(T.TOK_RPAREN) || check(T.TOK_RBRACE) || check(T.TOK_RBRACKET)) { if (ed === 0) break; ed--; advance(); }
            else if (check(T.TOK_COMMA) && ed === 0) break;
            else if (check(T.TOK_IDENT)) {
              const first = p.current;
              if (isJsxElement(first)) { const call = recordCall(first.value, first.value, false, false); callTarget.calls.push(call.id); advance(); continue; }
              advance();
              let chain = first.value;
              while ((check(T.TOK_DOT) || check(T.TOK_QUESTIONDOT)) && !check(T.TOK_EOF)) {
                chain += '.'; advance();
                if (check(T.TOK_IDENT) || check(T.TOK_CATCH) || check(T.TOK_FINALLY) || check(T.TOK_DELETE)) { chain += p.current.value; advance(); } else break;
              }
              if (check(T.TOK_LPAREN) || check(T.TOK_LT)) {
                if (check(T.TOK_LT)) trySkipGenericArgs();
                if (check(T.TOK_LPAREN)) {
                  if (chain.length > first.value.length) recordIdentRef(first);
                  const call = recordCall(first.value, chain, false, false);
                  callTarget.calls.push(call.id);
                  const cbEff = checkSideEffect(chain);
                  if (cbEff !== EFFECT_NONE) {
                    const se = addSideEffect(ast, { loc: makeLoc(first), type: cbEff, apiCall: chain, containingFunc: callTarget.id });
                    callTarget.sideEffects.push(se.id);
                  }
                  const lastSeg = chain.includes('.') ? chain.split('.').pop() : chain;
                  advance(); scanCallbackArgs(callTarget, false, lastSeg);
                  // scanCallbackArgs leaves current on the closing ), advance past it
                  // so the expression body's ed counter doesn't double-count it
                  if (check(T.TOK_RPAREN)) advance();
                }
              } else recordIdentRef(first);
            } else if (check(T.TOK_TEMPLATE)) { scanTemplateRefs(p.current); advance(); }
            else advance();
          }
        }
      } else if (check(T.TOK_IDENT)) {
        const first = p.current; advance();
        if (check(T.TOK_LPAREN)) {
          const call = recordCall(first.value, first.value, false, false);
          func.calls.push(call.id); advance(); scanCallbackArgs(func, false);
          if (check(T.TOK_RPAREN)) advance();
        } else if (check(T.TOK_DOT) || check(T.TOK_QUESTIONDOT)) {
          recordIdentRef(first);
          let lastSeg = first.value;
          while (check(T.TOK_DOT) || check(T.TOK_QUESTIONDOT)) { advance(); if (check(T.TOK_IDENT) || check(T.TOK_CATCH) || check(T.TOK_FINALLY) || check(T.TOK_DELETE)) { lastSeg = p.current.value; advance(); } else break; }
          if (check(T.TOK_LPAREN)) { advance(); scanCallbackArgs(func, false, lastSeg); if (check(T.TOK_RPAREN)) advance(); }
        } else recordIdentRef(first);
      } else advance();
    }
    p.callbackScanDepth--;
    return firstArg;
  };

  // --- scan_arguments_for_calls (module-level) ---
  const scanModuleArgs = () => {
    let depth = 1;
    advance(); // (
    while (depth > 0 && !check(T.TOK_EOF)) {
      // Dynamic import
      if (check(T.TOK_IMPORT)) {
        const importTok = p.current; advance();
        if (check(T.TOK_LPAREN)) {
          advance();
          if (check(T.TOK_STRING)) { recordDynamicImport(importTok, internString(p.current), null, true); advance(); }
          else {
            const es = p.current.offset; let pd2 = 1;
            while (pd2 > 0 && !check(T.TOK_EOF)) { if (check(T.TOK_LPAREN)) pd2++; else if (check(T.TOK_RPAREN)) pd2--; if (pd2 > 0) advance(); }
            recordDynamicImport(importTok, null, source.slice(es, p.current.offset), false);
          }
          if (check(T.TOK_RPAREN)) advance();
        }
        continue;
      }
      if (check(T.TOK_LPAREN)) { depth++; advance(); }
      else if (check(T.TOK_RPAREN)) { depth--; advance(); }
      else if (check(T.TOK_LBRACE)) {
        advance();
        let bd = 1;
        while (bd > 0 && !check(T.TOK_EOF)) {
          if (check(T.TOK_LBRACE)) { bd++; advance(); }
          else if (check(T.TOK_RBRACE)) { bd--; advance(); }
          else if (check(T.TOK_IDENT)) {
            const first = p.current;
            if (isJsxElement(first)) { const c = recordCall(first.value, first.value, false, false); p.currentModulePtr.calls.push(c.id); advance(); continue; }
            advance();
            if (check(T.TOK_LPAREN)) {
              const c = recordCall(first.value, first.value, false, false);
              p.currentModulePtr.calls.push(c.id); scanModuleArgs();
            } else if (check(T.TOK_DOT) || check(T.TOK_QUESTIONDOT)) {
              recordIdentRef(first);
              while (check(T.TOK_DOT) || check(T.TOK_QUESTIONDOT)) { advance(); if (check(T.TOK_IDENT)) advance(); else break; }
              if (check(T.TOK_LPAREN)) scanModuleArgs();
            } else if (check(T.TOK_COMMA) || check(T.TOK_RBRACE) || check(T.TOK_RPAREN)) {
              recordIdentRef(first);
            } else recordIdentRef(first);
          } else if (check(T.TOK_TEMPLATE)) { scanTemplateRefs(p.current); advance(); }
          else advance();
        }
      } else if (check(T.TOK_IDENT)) {
        const first = p.current;
        if (isJsxElement(first)) { const c = recordCall(first.value, first.value, false, false); p.currentModulePtr.calls.push(c.id); advance(); }
        else if (isJsxAttrValueStart()) {
          if (isPascalCase(first)) { const c = recordCall(first.value, first.value, false, false); p.currentModulePtr.calls.push(c.id); }
          else recordIdentRef(first);
          advance();
        } else {
          advance();
          if (check(T.TOK_LPAREN)) {
            const c = recordCall(first.value, first.value, false, false);
            p.currentModulePtr.calls.push(c.id); scanModuleArgs();
          } else if (check(T.TOK_DOT) || check(T.TOK_QUESTIONDOT)) {
            recordIdentRef(first);
            while (check(T.TOK_DOT) || check(T.TOK_QUESTIONDOT)) { advance(); if (check(T.TOK_IDENT)) advance(); else break; }
            if (check(T.TOK_LPAREN)) scanModuleArgs();
          } else recordIdentRef(first);
        }
      } else if (check(T.TOK_TEMPLATE)) { scanTemplateRefs(p.current); advance(); }
      else advance();
    }
  };

  // --- parse_function_body ---
  const parseFunctionBody = (func) => {
    const startLine = p.current.line;
    let braceDepth = 1, maxNesting = 1, branches = 0, cognitive = 0, loopCount = 0;
    let prevWasNew = false, prevWasAwait = false;
    const loopStack = []; // brace depths where loop bodies start
    let pendingLoop = false; // next LBRACE opens a loop body
    const tagLoop = (call) => { if (loopStack.length) call.insideLoop = true; return call; };

    while (braceDepth > 0 && !check(T.TOK_EOF)) {
      if (check(T.TOK_LBRACE)) { braceDepth++; scopeBegin(); if (pendingLoop) { loopStack.push(braceDepth); pendingLoop = false; } if (braceDepth > maxNesting) maxNesting = braceDepth; advance(); continue; }
      if (check(T.TOK_RBRACE)) { if (loopStack.length && loopStack[loopStack.length - 1] === braceDepth) loopStack.pop(); braceDepth--; scopeEnd(); if (braceDepth > 0) advance(); continue; }

      // Complexity
      switch (p.current.type) {
        case T.TOK_IF: branches++; cognitive += braceDepth; break;
        case T.TOK_ELSE: cognitive++; break;
        case T.TOK_FOR: case T.TOK_WHILE: case T.TOK_DO: branches++; loopCount++; pendingLoop = true; cognitive += braceDepth; break;
        case T.TOK_CASE: branches++; cognitive++; break;
        case T.TOK_AMPAMP: case T.TOK_PIPEPIPE: case T.TOK_QUESTIONQUESTION: branches++; break;
        case T.TOK_BREAK: case T.TOK_CONTINUE: cognitive++; break;
      }

      if (check(T.TOK_NEW)) { prevWasNew = true; advance(); continue; }
      if (check(T.TOK_AWAIT)) { prevWasAwait = true; advance(); continue; }

      // Try-catch
      if (check(T.TOK_TRY)) {
        const tc = addTryCatch(ast, { loc: makeLoc(p.current), containingFunc: func.id });
        func.tryCatches.push(tc.id); advance(); continue;
      }
      if (check(T.TOK_CATCH) && p.previous?.type !== T.TOK_DOT && p.previous?.type !== T.TOK_QUESTIONDOT) {
        if (func.tryCatches.length > 0) {
          const tc = ast.tryCatches.find(t => t.id === func.tryCatches[func.tryCatches.length - 1]);
          if (tc) tc.hasCatch = true;
        }
        advance();
        if (match(T.TOK_LPAREN)) {
          if (check(T.TOK_IDENT) && func.tryCatches.length > 0) {
            const tc = ast.tryCatches.find(t => t.id === func.tryCatches[func.tryCatches.length - 1]);
            if (tc) tc.catchParam = intern(p.current);
          }
          let pd = 1;
          while (pd > 0 && !check(T.TOK_EOF)) { if (check(T.TOK_LPAREN)) pd++; else if (check(T.TOK_RPAREN)) pd--; advance(); }
        }
        if (check(T.TOK_LBRACE)) {
          advance(); braceDepth++;
          if (braceDepth > maxNesting) maxNesting = braceDepth;
          if (check(T.TOK_RBRACE) && func.tryCatches.length > 0) {
            const tc = ast.tryCatches.find(t => t.id === func.tryCatches[func.tryCatches.length - 1]);
            if (tc) tc.catchIsEmpty = true;
          }
        }
        continue;
      }
      if (check(T.TOK_FINALLY) && p.previous?.type !== T.TOK_DOT && p.previous?.type !== T.TOK_QUESTIONDOT) {
        if (func.tryCatches.length > 0) {
          const tc = ast.tryCatches.find(t => t.id === func.tryCatches[func.tryCatches.length - 1]);
          if (tc) tc.hasFinally = true;
        }
        advance(); continue;
      }

      // Inner function declaration: [async] function name(...) { body }
      if (check(T.TOK_FUNCTION) || check(T.TOK_ASYNC)) {
        let funcFlags = 0;
        let isFunc = check(T.TOK_FUNCTION);
        if (!isFunc) {
          const sls = { ...lexer.state }; const sc = p.current; const sp = p.previous; const spp = p.prevPrev;
          funcFlags |= FUNC_ASYNC; advance();
          isFunc = check(T.TOK_FUNCTION);
          if (!isFunc) { Object.assign(lexer.state, sls); p.current = sc; p.previous = sp; p.prevPrev = spp; }
        }
        if (isFunc) {
          advance(); // skip 'function'
          if (check(T.TOK_STAR)) { funcFlags |= FUNC_GENERATOR; advance(); }
          if (check(T.TOK_IDENT) || checkIdentOrKeyword()) {
            const innerName = intern(p.current);
            const innerLoc = makeLoc(p.current);
            scopeAddLocal(innerName);
            advance();
            const innerFunc = addFunction(ast, { name: innerName, loc: innerLoc, flags: funcFlags, module: p.currentModule, containingFunc: func.id });
            const outerFunc = p.currentFunction;
            p.currentFunction = innerFunc.id;
            innerFunc.typeParams = parseTypeParams();
            if (match(T.TOK_LPAREN)) {
              innerFunc.params = parseParams();
              consume(T.TOK_RPAREN, "Expected ')' after parameters");
            }
            if (match(T.TOK_COLON)) innerFunc.returnType = parseTypeAnnotation();
            if (check(T.TOK_LBRACE)) {
              advance(); // skip {
              parseFunctionBody(innerFunc);
              if (check(T.TOK_RBRACE)) advance();
            }
            p.currentFunction = outerFunc;
            p.currentModulePtr.functions.push(innerFunc.id);
            continue;
          }
        }
      }

      // Local variable / inner arrow function tracking
      if (check(T.TOK_CONST) || check(T.TOK_LET) || check(T.TOK_VAR)) {
        advance();
        if (check(T.TOK_IDENT)) {
          const innerName = intern(p.current);
          const innerLoc = makeLoc(p.current);
          scopeAddLocal(innerName);
          advance();
          // Check for inner arrow: const name = [async] (...) => { body }
          if (match(T.TOK_EQ)) {
            let isAsync = false;
            if (check(T.TOK_ASYNC)) { isAsync = true; advance(); }
            if (check(T.TOK_LPAREN) || (check(T.TOK_IDENT) && !check(T.TOK_ASYNC))) {
              // Look ahead to see if this is an arrow function
              const saved = { ...lexer.state };
              const savedCur = p.current;
              const savedPrev = p.previous;
              const savedPP = p.prevPrev;
              // Skip params
              if (check(T.TOK_LPAREN)) {
                let pd = 1; advance();
                while (pd > 0 && !check(T.TOK_EOF)) {
                  if (check(T.TOK_LPAREN)) pd++;
                  else if (check(T.TOK_RPAREN)) pd--;
                  if (pd > 0) advance();
                }
                if (check(T.TOK_RPAREN)) advance();
              } else {
                advance(); // single param ident
              }
              // Skip optional return type annotation
              if (check(T.TOK_COLON)) {
                advance();
                let td = 0;
                while (!check(T.TOK_EOF)) {
                  if (check(T.TOK_LT) || check(T.TOK_LPAREN) || check(T.TOK_LBRACE) || check(T.TOK_LBRACKET)) { td++; advance(); }
                  else if (check(T.TOK_GT) || check(T.TOK_RPAREN) || check(T.TOK_RBRACE) || check(T.TOK_RBRACKET)) { if (td > 0) { td--; advance(); } else break; }
                  else if (td === 0 && (check(T.TOK_ARROW) || check(T.TOK_SEMI) || check(T.TOK_COMMA))) break;
                  else advance();
                }
              }
              const isArrow = check(T.TOK_ARROW);
              // Restore
              Object.assign(lexer.state, saved);
              p.current = savedCur;
              p.previous = savedPrev;
              p.prevPrev = savedPP;

              if (isArrow) {
                // Parse as inner function
                let funcFlags = FUNC_ARROW;
                if (isAsync) funcFlags |= FUNC_ASYNC;
                const innerFunc = addFunction(ast, { name: innerName, loc: innerLoc, flags: funcFlags, module: p.currentModule, containingFunc: func.id });
                const outerFunc = p.currentFunction;
                p.currentFunction = innerFunc.id;
                innerFunc.typeParams = parseTypeParams();
                if (check(T.TOK_IDENT)) {
                  const pName = intern(p.current); advance();
                  let pType = '';
                  if (match(T.TOK_COLON)) pType = parseTypeAnnotation();
                  innerFunc.params.push({ name: pName, typeAnnotation: pType, defaultValue: '', isOptional: false, isRest: false, isDestructured: false });
                } else if (match(T.TOK_LPAREN)) {
                  innerFunc.params = parseParams();
                  consume(T.TOK_RPAREN, "Expected ')' after parameters");
                }
                if (match(T.TOK_COLON)) innerFunc.returnType = parseTypeAnnotation();
                if (!match(T.TOK_ARROW)) { advance(); }
                if (check(T.TOK_LBRACE)) {
                  advance(); // skip {
                  parseFunctionBody(innerFunc);
                  // parseFunctionBody exits with } as current token
                  if (check(T.TOK_RBRACE)) advance();
                } else {
                  // Expression body arrow — scan to end
                  let ed = 0;
                  while (!check(T.TOK_EOF)) {
                    if (check(T.TOK_LPAREN) || check(T.TOK_LBRACE) || check(T.TOK_LBRACKET)) ed++;
                    else if (check(T.TOK_RPAREN) || check(T.TOK_RBRACE) || check(T.TOK_RBRACKET)) { if (ed === 0) break; ed--; }
                    else if (ed === 0 && (check(T.TOK_COMMA) || check(T.TOK_SEMI))) break;
                    if (check(T.TOK_IDENT)) {
                      const ref = p.current; advance();
                      const chain = buildChain(ref);
                      if (check(T.TOK_LPAREN)) {
                        if (chain.length > ref.value.length) recordIdentRef(ref);
                        const call = recordCall(ref.value, chain, false, false);
                        innerFunc.calls.push(call.id);
                        advance(); scanCallbackArgs(innerFunc, false);
                        if (check(T.TOK_RPAREN)) advance();
                      } else {
                        recordIdentRef(ref);
                      }
                      continue;
                    }
                    advance();
                  }
                  innerFunc.lineCount = 1;
                }
                p.currentFunction = outerFunc;
                func.functions = func.functions || [];
                func.functions.push(innerFunc.id);
                p.currentModulePtr.functions.push(innerFunc.id);
                continue;
              }
            }
            // Not an arrow — fall through to scan rest of initializer
            // Scan rest of initializer (calls, refs)
            let depth2 = 0, initNew = false, initAwait = false;
            while (!check(T.TOK_EOF)) {
              if (check(T.TOK_LPAREN) || check(T.TOK_LBRACE) || check(T.TOK_LBRACKET)) depth2++;
              else if (check(T.TOK_RPAREN) || check(T.TOK_RBRACE) || check(T.TOK_RBRACKET)) { if (depth2 === 0) break; depth2--; }
              else if (depth2 === 0 && (check(T.TOK_COMMA) || check(T.TOK_SEMI))) break;
              if (check(T.TOK_NEW)) { initNew = true; advance(); continue; }
              if (check(T.TOK_AWAIT)) { initAwait = true; advance(); continue; }
              if (check(T.TOK_IDENT)) {
                const ref = p.current; advance();
                const chain = buildChain(ref);
                if (check(T.TOK_LT)) trySkipGenericArgs();
                if (check(T.TOK_LPAREN)) {
                  if (chain.length > ref.value.length) recordIdentRef(ref);
                  const call = recordCall(ref.value, chain, initNew, initAwait);
                  func.calls.push(call.id);
                  const initEff = checkSideEffect(chain);
                  if (initEff !== EFFECT_NONE) {
                    const se = addSideEffect(ast, { loc: makeLoc(ref), type: initEff, apiCall: chain, containingFunc: func.id });
                    func.sideEffects.push(se.id);
                  }
                  advance();
                  // CJS require inside function body: const x = require("module")
                  if (ref.value === 'require' && check(T.TOK_STRING)) {
                    const imp = addImport(ast, {
                      loc: makeLoc(ref), source: internString(p.current),
                      module: p.currentModule,
                      specifiers: [{ imported: 'default', local: innerName || 'default', isTypeOnly: false }],
                    });
                    p.currentModulePtr.imports.push(imp.id);
                  }
                  const initLastSeg = chain.includes('.') ? chain.split('.').pop() : ref.value;
                  const fa = scanCallbackArgs(func, true, initLastSeg);
                  if (fa) call.firstArg = fa;
                  if (check(T.TOK_RPAREN)) advance();
                } else {
                  recordIdentRef(ref);
                }
                initNew = false; initAwait = false; continue;
              }
              initNew = false; initAwait = false; advance();
            }
          }
        }
        continue;
      }

      if (check(T.TOK_RETURN)) { advance(); continue; }

      // Template refs
      if (check(T.TOK_TEMPLATE)) { scanTemplateRefs(p.current); advance(); continue; }
      // Spread
      if (check(T.TOK_DOTDOTDOT)) { advance(); if (check(T.TOK_IDENT)) recordIdentRef(p.current); continue; }

      // Dynamic import
      if (check(T.TOK_IMPORT)) {
        const importTok = p.current; advance();
        if (check(T.TOK_LPAREN)) {
          advance();
          if (check(T.TOK_STRING)) { recordDynamicImport(importTok, internString(p.current), null, true); advance(); }
          else {
            const es = p.current.offset; let pd3 = 1;
            while (pd3 > 0 && !check(T.TOK_EOF)) { if (check(T.TOK_LPAREN)) pd3++; else if (check(T.TOK_RPAREN)) pd3--; if (pd3 > 0) advance(); }
            recordDynamicImport(importTok, null, source.slice(es, p.current.offset), false);
          }
          if (check(T.TOK_RPAREN)) advance();
        }
        prevWasNew = false; prevWasAwait = false; continue;
      }

      // Function call detection
      if (check(T.TOK_IDENT)) {
        const first = p.current;
        // JSX component
        if (isJsxElement(first)) {
          const call = tagLoop(recordCall(first.value, first.value, false, false));
          func.calls.push(call.id); advance(); prevWasNew = false; prevWasAwait = false; continue;
        }
        // JSX attr value
        if (isJsxAttrValueStart()) {
          if (isPascalCase(first)) { const call = tagLoop(recordCall(first.value, first.value, false, false)); func.calls.push(call.id); }
          else recordIdentRef(first);
          advance(); prevWasNew = false; prevWasAwait = false; continue;
        }

        advance();
        const chain = buildChain(first);

        if (check(T.TOK_LPAREN) || check(T.TOK_LT)) {
          if (check(T.TOK_LT)) trySkipGenericArgs();
          if (check(T.TOK_LPAREN)) {
            const callee = first.value;
            if (chain.length > callee.length) recordIdentRef(first);
            const call = tagLoop(recordCall(callee, chain, prevWasNew, prevWasAwait));
            func.calls.push(call.id);
            const eff = checkSideEffect(chain);
            if (eff !== EFFECT_NONE) {
              const se = addSideEffect(ast, { loc: makeLoc(first), type: eff, apiCall: chain, containingFunc: func.id });
              func.sideEffects.push(se.id);
            }
            const lastSeg = chain.includes('.') ? chain.split('.').pop() : callee;
            advance(); // (
            const fa = scanCallbackArgs(func, true, lastSeg);
            if (fa) call.firstArg = fa;
            // Bare require inside function body: require("module").config()
            if (callee === 'require' && fa && !fa.includes(' ')) {
              const imp = addImport(ast, {
                loc: makeLoc(first), source: fa.replace(/['"]/g, ''),
                module: p.currentModule,
                specifiers: [{ imported: 'default', local: 'default', isTypeOnly: false }],
              });
              p.currentModulePtr.imports.push(imp.id);
            }
          }
        } else {
          recordIdentRef(first);
        }
        prevWasNew = false; prevWasAwait = false; continue;
      }

      // Handle keyword method calls: .catch(), .finally(), .delete()
      if (check(T.TOK_CATCH) || check(T.TOK_FINALLY) || check(T.TOK_DELETE)) {
        const first = p.current; advance();
        if (check(T.TOK_LPAREN)) {
          const call = tagLoop(recordCall(first.value, first.value, false, false));
          func.calls.push(call.id);
          advance();
          scanCallbackArgs(func, true, first.value);
        }
        prevWasNew = false; prevWasAwait = false; continue;
      }

      prevWasNew = false; prevWasAwait = false; advance();
    }

    func.lineCount = p.current.line - startLine;
    func.complexity = branches + 1;
    func.cognitive = cognitive;
    func.maxNesting = maxNesting;
    func.loopCount = loopCount;
  };

  // --- parse_function ---
  const parseFunction = (flags) => {
    const func = addFunction(ast, { flags, module: p.currentModule });
    const outerFunc = p.currentFunction;
    p.currentFunction = func.id;

    if (!(flags & FUNC_ARROW)) { if (match(T.TOK_STAR)) func.flags |= FUNC_GENERATOR; }

    if (check(T.TOK_IDENT)) { func.name = intern(p.current); func.loc = makeLoc(p.current); advance(); }
    else func.loc = makeLoc(p.current);

    func.typeParams = parseTypeParams();
    scopeBegin();
    consume(T.TOK_LPAREN, "Expected '(' after function name");
    func.params = parseParams();
    consume(T.TOK_RPAREN, "Expected ')' after parameters");

    for (const param of func.params) { if (param.name) scopeAddLocal(param.name); }

    if (match(T.TOK_COLON)) func.returnType = parseTypeAnnotation();
    if (flags & FUNC_ARROW) consume(T.TOK_ARROW, "Expected '=>'");

    if (match(T.TOK_LBRACE)) {
      parseFunctionBody(func);
      consume(T.TOK_RBRACE, "Expected '}' after function body");
    } else if (flags & FUNC_ARROW) {
      // Expression body
      let depth = 0;
      while (!check(T.TOK_EOF)) {
        if (check(T.TOK_LPAREN) || check(T.TOK_LBRACE) || check(T.TOK_LBRACKET)) depth++;
        else if (check(T.TOK_RPAREN) || check(T.TOK_RBRACE) || check(T.TOK_RBRACKET)) { if (depth === 0) break; depth--; }
        else if (depth === 0 && (check(T.TOK_COMMA) || check(T.TOK_SEMI))) break;
        advance();
      }
      func.lineCount = 1;
    }

    scopeEnd();
    p.currentFunction = outerFunc;
    return func;
  };

  // --- parse_method ---
  const parseMethod = (methodFlags) => {
    let flags = FUNC_METHOD | methodFlags;
    if (match(T.TOK_ASYNC)) flags |= FUNC_ASYNC;
    if (match(T.TOK_GET)) flags |= FUNC_GETTER;
    if (match(T.TOK_SET)) flags |= FUNC_SETTER;
    if (match(T.TOK_STAR)) flags |= FUNC_GENERATOR;
    return parseFunction(flags);
  };

  // --- parse_class ---
  const parseClass = (flags) => {
    const cls = addClass(ast, { flags, module: p.currentModule });
    const outerClass = p.currentClass;
    p.currentClass = cls.id;
    advance(); // 'class'

    if (check(T.TOK_IDENT)) { cls.name = intern(p.current); cls.loc = makeLoc(p.current); advance(); }
    else cls.loc = makeLoc(p.current);

    cls.typeParams = parseTypeParams();

    if (match(T.TOK_EXTENDS)) {
      if (check(T.TOK_IDENT)) { cls.extends = intern(p.current); advance(); }
      if (match(T.TOK_LT)) skipBalanced(T.TOK_LT, T.TOK_GT);
    }
    if (match(T.TOK_IMPLEMENTS)) {
      do {
        if (check(T.TOK_IDENT)) { cls.implements.push(intern(p.current)); advance(); }
        if (match(T.TOK_LT)) skipBalanced(T.TOK_LT, T.TOK_GT);
      } while (match(T.TOK_COMMA));
    }

    consume(T.TOK_LBRACE, "Expected '{' before class body");

    while (!check(T.TOK_RBRACE) && !check(T.TOK_EOF)) {
      const memberDecorators = parseDecorators();
      let memberFlags = 0;
      for (;;) {
        if (match(T.TOK_STATIC)) { memberFlags |= FUNC_STATIC; continue; }
        if (match(T.TOK_PRIVATE)) { memberFlags |= FUNC_PRIVATE; continue; }
        if (match(T.TOK_PROTECTED)) { memberFlags |= FUNC_PROTECTED; continue; }
        if (match(T.TOK_PUBLIC)) { memberFlags |= FUNC_PUBLIC; continue; }
        if (match(T.TOK_ABSTRACT)) { memberFlags |= FUNC_ABSTRACT; continue; }
        if (match(T.TOK_READONLY)) continue;
        if (match(T.TOK_OVERRIDE)) continue;
        break;
      }

      // Constructor
      if (check(T.TOK_IDENT) && p.current.value === 'constructor') {
        const meth = parseMethod(memberFlags);
        cls.constructor = meth.id;
        meth.parentClass = cls.id;
        meth.decorators = memberDecorators;
        continue;
      }

      if (check(T.TOK_IDENT) || check(T.TOK_ASYNC) || check(T.TOK_GET) || check(T.TOK_SET) || check(T.TOK_STAR) || check(T.TOK_HASH)) {
        if (match(T.TOK_HASH)) { memberFlags |= FUNC_HASH_PRIVATE; }
        if (match(T.TOK_ASYNC)) { memberFlags |= FUNC_ASYNC; if (!check(T.TOK_IDENT) && !check(T.TOK_STAR)) continue; }

        // Handle getters/setters
        if (check(T.TOK_GET)) {
          memberFlags |= FUNC_GETTER;
          const meth = parseMethod(memberFlags);
          cls.methods.push(meth.id); meth.parentClass = cls.id; meth.decorators = memberDecorators; continue;
        }
        if (check(T.TOK_SET)) {
          memberFlags |= FUNC_SETTER;
          const meth = parseMethod(memberFlags);
          cls.methods.push(meth.id); meth.parentClass = cls.id; meth.decorators = memberDecorators; continue;
        }

        const nameTok = p.current;
        // Save lexer state for lookahead
        const savedLexState = { ...lexer.state };
        const savedCurrent = p.current;
        advance();

        if (check(T.TOK_LPAREN) || check(T.TOK_LT)) {
          // Method — restore and parse
          Object.assign(lexer.state, savedLexState);
          p.current = savedCurrent;
          const meth = parseMethod(memberFlags);
          cls.methods.push(meth.id); meth.parentClass = cls.id; meth.decorators = memberDecorators;
        } else {
          // Property
          const prop = {
            name: intern(nameTok), loc: makeLoc(nameTok), flags: memberFlags,
            typeAnnotation: '', isOptional: false, isPrivateField: !!(memberFlags & FUNC_HASH_PRIVATE),
          };
          if (match(T.TOK_QUESTION)) prop.isOptional = true;
          if (match(T.TOK_COLON)) prop.typeAnnotation = parseTypeAnnotation();
          if (match(T.TOK_EQ)) {
            let depth = 0;
            while (!check(T.TOK_EOF)) {
              if (check(T.TOK_LPAREN) || check(T.TOK_LBRACE) || check(T.TOK_LBRACKET)) depth++;
              else if (check(T.TOK_RPAREN) || check(T.TOK_RBRACE) || check(T.TOK_RBRACKET)) { if (depth === 0) break; depth--; }
              else if (depth === 0 && (check(T.TOK_SEMI) || check(T.TOK_RBRACE))) break;
              advance();
            }
          }
          cls.properties.push(prop);
        }
        match(T.TOK_SEMI);
        continue;
      }
      advance();
    }

    consume(T.TOK_RBRACE, "Expected '}' after class body");
    p.currentClass = outerClass;
    return cls;
  };

  // --- parse_export ---
  const parseExportDecl = () => {
    const exportTok = p.current;
    advance(); // 'export'
    const exp = addExport(ast, { loc: makeLoc(exportTok), module: p.currentModule });

    // export type
    if (match(T.TOK_TYPE) && !check(T.TOK_LBRACE) && !check(T.TOK_STAR)) {
      if (check(T.TOK_IDENT)) {
        exp.isTypeOnly = true;
        // type alias export — fall through to type alias parsing below
        return parseExportTypeAlias(exp);
      }
      exp.isTypeOnly = true;
    }

    // export default
    if (match(T.TOK_DEFAULT)) {
      exp.isDefault = true;
      if (check(T.TOK_FUNCTION) || check(T.TOK_ASYNC)) {
        let flags = FUNC_EXPORTED | FUNC_DEFAULT;
        if (match(T.TOK_ASYNC)) flags |= FUNC_ASYNC;
        consume(T.TOK_FUNCTION, "Expected 'function'");
        const func = parseFunction(flags);
        exp.declaration = func.id;
        p.currentModulePtr.functions.push(func.id);
      } else if (check(T.TOK_CLASS)) {
        const cls = parseClass(CLASS_EXPORTED | CLASS_DEFAULT);
        exp.declaration = cls.id;
        p.currentModulePtr.classes.push(cls.id);
      } else if (check(T.TOK_IDENT)) {
        const exportedName = intern(p.current); advance();
        exp.specifiers.push({ local: exportedName, exported: exportedName });
        // Mark referenced function/class as exported
        for (const fid of p.currentModulePtr.functions) {
          const f = ast.functions.find(fn => fn.id === fid);
          if (f && f.name === exportedName) { f.flags |= (FUNC_EXPORTED | FUNC_DEFAULT); break; }
        }
        for (const cid of p.currentModulePtr.classes) {
          const c = ast.classes.find(cl => cl.id === cid);
          if (c && c.name === exportedName) { c.flags |= (CLASS_EXPORTED | CLASS_DEFAULT); break; }
        }
      } else {
        let depth = 0;
        while (!check(T.TOK_EOF)) {
          if (check(T.TOK_LPAREN) || check(T.TOK_LBRACE) || check(T.TOK_LBRACKET)) depth++;
          else if (check(T.TOK_RPAREN) || check(T.TOK_RBRACE) || check(T.TOK_RBRACKET)) { if (depth === 0) break; depth--; }
          else if (depth === 0 && check(T.TOK_SEMI)) break;
          advance();
        }
      }
      return exp;
    }

    // export *
    if (match(T.TOK_STAR)) {
      exp.isAll = true;
      if (match(T.TOK_AS)) {
        if (check(T.TOK_IDENT)) { exp.specifiers.push({ local: '', exported: intern(p.current) }); advance(); }
      }
      consume(T.TOK_FROM, "Expected 'from'");
      if (check(T.TOK_STRING)) { exp.source = intern(p.current); advance(); }
      return exp;
    }

    // export { ... }
    if (check(T.TOK_LBRACE)) {
      advance();
      while (!check(T.TOK_RBRACE) && !check(T.TOK_EOF)) {
        match(T.TOK_TYPE); // type-only specifier
        if (check(T.TOK_IDENT) || check(T.TOK_DEFAULT)) {
          const local = intern(p.current); advance();
          let exported = local;
          if (match(T.TOK_AS)) { if (check(T.TOK_IDENT) || check(T.TOK_DEFAULT)) { exported = intern(p.current); advance(); } }
          exp.specifiers.push({ local, exported });
        }
        if (!match(T.TOK_COMMA)) break;
      }
      consume(T.TOK_RBRACE, "Expected '}'");
      if (match(T.TOK_FROM)) { if (check(T.TOK_STRING)) { exp.source = intern(p.current); advance(); } }
      return exp;
    }

    // export function/class/const/let/var/interface/type/enum
    if (check(T.TOK_FUNCTION) || check(T.TOK_ASYNC)) {
      let flags = FUNC_EXPORTED;
      if (match(T.TOK_ASYNC)) flags |= FUNC_ASYNC;
      consume(T.TOK_FUNCTION, "Expected 'function'");
      const func = parseFunction(flags);
      exp.declaration = func.id;
      p.currentModulePtr.functions.push(func.id);
    } else if (check(T.TOK_ABSTRACT)) {
      advance(); // abstract
      if (check(T.TOK_CLASS)) {
        const cls = parseClass(CLASS_EXPORTED | CLASS_ABSTRACT);
        exp.declaration = cls.id;
        p.currentModulePtr.classes.push(cls.id);
      }
    } else if (check(T.TOK_CLASS)) {
      const cls = parseClass(CLASS_EXPORTED);
      exp.declaration = cls.id;
      p.currentModulePtr.classes.push(cls.id);
    } else if (check(T.TOK_CONST) || check(T.TOK_LET) || check(T.TOK_VAR)) {
      const varsBefore = p.currentModulePtr.variables.length;
      const funcsBefore = p.currentModulePtr.functions.length;
      parseDeclaration(true);
      for (let i = varsBefore; i < p.currentModulePtr.variables.length; i++) {
        const v = ast.variables.find(vr => vr.id === p.currentModulePtr.variables[i]);
        if (v?.name) exp.specifiers.push({ local: v.name, exported: v.name });
      }
      for (let i = funcsBefore; i < p.currentModulePtr.functions.length; i++) {
        const f = ast.functions.find(fn => fn.id === p.currentModulePtr.functions[i]);
        if (f?.name && (f.flags & FUNC_ARROW)) exp.specifiers.push({ local: f.name, exported: f.name });
      }
    } else if (check(T.TOK_INTERFACE)) {
      advance();
      if (check(T.TOK_IDENT)) {
        const ifaceName = intern(p.current);
        const iface = addInterface(ast, { name: ifaceName, loc: makeLoc(p.current), module: p.currentModule });
        advance();
        iface.typeParams = parseTypeParams();
        if (match(T.TOK_EXTENDS)) { do { if (check(T.TOK_IDENT)) { iface.extends.push(intern(p.current)); advance(); } if (check(T.TOK_LT)) skipBalanced(T.TOK_LT, T.TOK_GT); } while (match(T.TOK_COMMA)); }
        if (match(T.TOK_LBRACE)) scanInterfaceBody();
        p.currentModulePtr.interfaces.push(iface.id);
        exp.specifiers.push({ local: ifaceName, exported: ifaceName });
      }
    } else if (check(T.TOK_TYPE)) {
      advance(); // consume 'type'
      return parseExportTypeAlias(exp);
    } else if (check(T.TOK_ENUM)) {
      advance();
      if (check(T.TOK_IDENT)) advance();
      if (match(T.TOK_LBRACE)) skipBalanced(T.TOK_LBRACE, T.TOK_RBRACE);
    }

    return exp;
  };

  const parseExportTypeAlias = (exp) => {
    // Note: caller must have already consumed the 'type' keyword
    if (check(T.TOK_IDENT)) {
      const name = intern(p.current);
      const ta = addTypeAlias(ast, { name, loc: makeLoc(p.current), module: p.currentModule });
      advance();
      ta.typeParams = parseTypeParams();
      consume(T.TOK_EQ, "Expected '=' in type alias");
      ta.definition = parseTypeAnnotation();
      scanTypeForRefs(ta.definition);
      p.currentModulePtr.typeAliases.push(ta.id);
      exp.specifiers.push({ local: name, exported: name });
    }
    return exp;
  };

  // --- looks_like_arrow_function ---
  const looksLikeArrow = () => {
    if (check(T.TOK_ASYNC) || check(T.TOK_LPAREN) || check(T.TOK_LT)) return true;
    if (check(T.TOK_IDENT)) {
      const saved = { ...lexer.state };
      const savedCur = p.current;
      const savedPrev = p.previous;
      const savedPP = p.prevPrev;
      advance();
      if (check(T.TOK_COLON)) {
        advance();
        // Skip type annotation lookahead
        let depth = 0;
        while (!check(T.TOK_EOF)) {
          if (check(T.TOK_LT) || check(T.TOK_LPAREN) || check(T.TOK_LBRACE) || check(T.TOK_LBRACKET)) { depth++; advance(); }
          else if (check(T.TOK_GT) || check(T.TOK_RPAREN) || check(T.TOK_RBRACE) || check(T.TOK_RBRACKET)) { if (depth > 0) { depth--; advance(); } else break; }
          else if (depth === 0 && (check(T.TOK_ARROW) || check(T.TOK_COMMA) || check(T.TOK_SEMI) || check(T.TOK_EQ))) break;
          else advance();
        }
      }
      const isArrow = check(T.TOK_ARROW);
      Object.assign(lexer.state, saved);
      p.current = savedCur; p.previous = savedPrev; p.prevPrev = savedPP;
      return isArrow;
    }
    return false;
  };

  // --- parse_declaration ---
  const parseDeclaration = (isExport) => {
    let varFlags = isExport ? VAR_EXPORTED : 0;
    if (match(T.TOK_CONST)) varFlags |= VAR_CONST;
    else if (match(T.TOK_LET)) varFlags |= VAR_LET;
    else if (match(T.TOK_VAR)) { /* no flag */ }

    do {
      if (check(T.TOK_LBRACE) || check(T.TOK_LBRACKET)) {
        const openType = p.current.type;
        const closeType = openType === T.TOK_LBRACE ? T.TOK_RBRACE : T.TOK_RBRACKET;
        const isObj = openType === T.TOK_LBRACE;
        // Capture destructured names for CJS require detection: const { a, b: c } = require("x")
        const destructNames = [];
        if (isObj) {
          advance(); // skip {
          while (!check(T.TOK_RBRACE) && !check(T.TOK_EOF)) {
            if (check(T.TOK_IDENT) || checkIdentOrKeyword()) {
              const imported = intern(p.current); advance();
              if (match(T.TOK_COLON)) {
                // { imported: local }
                if (check(T.TOK_IDENT) || checkIdentOrKeyword()) {
                  destructNames.push({ imported, local: intern(p.current) });
                  scopeAddLocal(intern(p.current)); advance();
                }
              } else {
                destructNames.push({ imported, local: imported });
                scopeAddLocal(imported);
              }
            }
            if (!match(T.TOK_COMMA)) break;
          }
          if (check(T.TOK_RBRACE)) advance();
        } else {
          advance(); skipBalanced(openType, closeType);
        }
        if (match(T.TOK_COLON)) parseTypeAnnotation();
        if (match(T.TOK_EQ)) {
          if (check(T.TOK_IDENT)) {
            const first = p.current; recordIdentRef(first); advance();
            if (first.value === 'require' && check(T.TOK_LPAREN)) {
              // CJS require — record as import: const { a, b } = require("source")
              advance(); // skip (
              if (check(T.TOK_STRING)) {
                const src = internString(p.current);
                const loc = makeLoc(first);
                const specifiers = destructNames.length > 0
                  ? destructNames.map(d => ({ imported: d.imported, local: d.local, isTypeOnly: false }))
                  : [{ imported: 'default', local: 'default', isTypeOnly: false }];
                const imp = addImport(ast, { loc, source: src, module: p.currentModule, specifiers });
                p.currentModulePtr.imports.push(imp.id);
                advance(); // skip string
              }
              if (check(T.TOK_RPAREN)) advance();
            } else if (check(T.TOK_LPAREN)) {
              const c = recordCall(first.value, first.value, false, false);
              p.currentModulePtr.calls.push(c.id); scanModuleArgs();
            }
          }
          let depth = 0;
          while (!check(T.TOK_EOF)) {
            if (check(T.TOK_LPAREN) || check(T.TOK_LBRACE) || check(T.TOK_LBRACKET)) depth++;
            else if (check(T.TOK_RPAREN) || check(T.TOK_RBRACE) || check(T.TOK_RBRACKET)) { if (depth === 0) break; depth--; }
            else if (depth === 0 && (check(T.TOK_COMMA) || check(T.TOK_SEMI))) break;
            advance();
          }
        }
      } else if (check(T.TOK_IDENT)) {
        const name = intern(p.current);
        const loc = makeLoc(p.current);
        advance();
        scopeAddLocal(name);
        let typeAnnotation = '';
        if (match(T.TOK_COLON)) typeAnnotation = parseTypeAnnotation();

        if (match(T.TOK_EQ) && looksLikeArrow()) {
          // Arrow function declaration
          let funcFlags = FUNC_ARROW;
          if (isExport) funcFlags |= FUNC_EXPORTED;
          if (match(T.TOK_ASYNC)) funcFlags |= FUNC_ASYNC;

          const func = addFunction(ast, { name, loc, flags: funcFlags, module: p.currentModule });
          const outerFunc = p.currentFunction;
          p.currentFunction = func.id;
          func.typeParams = parseTypeParams();

          if (check(T.TOK_IDENT)) {
            const pName = intern(p.current); advance();
            let pType = '';
            if (match(T.TOK_COLON)) pType = parseTypeAnnotation();
            func.params.push({ name: pName, typeAnnotation: pType, defaultValue: '', isOptional: false, isRest: false, isDestructured: false });
          } else if (match(T.TOK_LPAREN)) {
            func.params = parseParams();
            consume(T.TOK_RPAREN, "Expected ')' after parameters");
          } else {
            consume(T.TOK_LPAREN, "Expected '(' for arrow function parameters");
            func.params = parseParams();
            consume(T.TOK_RPAREN, "Expected ')' after parameters");
          }

          if (match(T.TOK_COLON)) func.returnType = parseTypeAnnotation();
          else if (typeAnnotation) func.returnType = typeAnnotation;

          consume(T.TOK_ARROW, "Expected '=>'");

          if (match(T.TOK_LBRACE)) {
            parseFunctionBody(func);
            consume(T.TOK_RBRACE, "Expected '}' after function body");
          } else {
            // Expression body with call tracking
            let depth = 0;
            while (!check(T.TOK_EOF)) {
              if (check(T.TOK_LPAREN) || check(T.TOK_LBRACE) || check(T.TOK_LBRACKET)) depth++;
              else if (check(T.TOK_RPAREN) || check(T.TOK_RBRACE) || check(T.TOK_RBRACKET)) { if (depth === 0) break; depth--; }
              else if (depth === 0 && (check(T.TOK_COMMA) || check(T.TOK_SEMI))) break;
              if (check(T.TOK_IDENT)) {
                const first = p.current;
                if (isJsxElement(first)) { const c = recordCall(first.value, first.value, false, false); func.calls.push(c.id); advance(); continue; }
                advance();
                let chain = first.value;
                while ((check(T.TOK_DOT) || check(T.TOK_QUESTIONDOT)) && !check(T.TOK_EOF)) {
                  chain += '.'; advance();
                  if (check(T.TOK_IDENT)) { chain += p.current.value; advance(); } else break;
                }
                if (check(T.TOK_LPAREN)) { const c = recordCall(first.value, chain, false, false); func.calls.push(c.id); }
                continue;
              }
              advance();
            }
            func.lineCount = 1;
          }

          p.currentFunction = outerFunc;
          p.currentModulePtr.functions.push(func.id);
        } else {
          // Regular variable
          const v = addVariable(ast, { name, loc, flags: varFlags, module: p.currentModule, typeAnnotation });
          p.currentModulePtr.variables.push(v.id);

          // Skip initializer with tracking
          if (p.previous?.type === T.TOK_EQ || check(T.TOK_EQ)) {
            if (check(T.TOK_EQ)) advance();
            if (check(T.TOK_IDENT)) {
              const first = p.current; recordIdentRef(first); advance();
              if (first.value === 'require' && check(T.TOK_LPAREN)) {
                // CJS require — record as import: const x = require("source")
                advance(); // skip (
                if (check(T.TOK_STRING)) {
                  const src = internString(p.current);
                  const imp = addImport(ast, {
                    loc, source: src, module: p.currentModule,
                    specifiers: [{ imported: 'default', local: name, isTypeOnly: false }],
                  });
                  p.currentModulePtr.imports.push(imp.id);
                  advance(); // skip string
                }
                if (check(T.TOK_RPAREN)) advance();
              } else if (check(T.TOK_LPAREN)) {
                const c = recordCall(first.value, first.value, false, false);
                p.currentModulePtr.calls.push(c.id); scanModuleArgs();
              }
            }
            if (check(T.TOK_TEMPLATE)) scanTemplateRefs(p.current);
            // Scan rest of initializer
            let depth = 0, initPrevNew = false;
            while (!check(T.TOK_EOF)) {
              if (check(T.TOK_LPAREN) || check(T.TOK_LBRACE) || check(T.TOK_LBRACKET)) depth++;
              else if (check(T.TOK_RPAREN) || check(T.TOK_RBRACE) || check(T.TOK_RBRACKET)) { if (depth === 0) break; depth--; }
              else if (depth === 0 && (check(T.TOK_COMMA) || check(T.TOK_SEMI))) break;
              if (check(T.TOK_NEW)) { initPrevNew = true; advance(); continue; }
              if (check(T.TOK_TEMPLATE)) { scanTemplateRefs(p.current); advance(); initPrevNew = false; continue; }
              if (check(T.TOK_IMPORT)) {
                const importTok = p.current; advance();
                if (check(T.TOK_LPAREN)) {
                  advance();
                  if (check(T.TOK_STRING)) { recordDynamicImport(importTok, internString(p.current), null, true); advance(); }
                  else if (check(T.TOK_TEMPLATE)) { recordDynamicImport(importTok, null, intern(p.current), false); advance(); }
                  else if (check(T.TOK_IDENT)) { recordDynamicImport(importTok, null, intern(p.current), false); advance(); }
                  if (check(T.TOK_RPAREN)) advance();
                }
                initPrevNew = false; continue;
              }
              if (check(T.TOK_IDENT)) {
                const first = p.current; advance();
                if (check(T.TOK_LPAREN)) {
                  const c = recordCall(first.value, first.value, initPrevNew, false);
                  p.currentModulePtr.calls.push(c.id); scanModuleArgs();
                } else if (check(T.TOK_DOT) || check(T.TOK_QUESTIONDOT)) {
                  recordIdentRef(first);
                  while (check(T.TOK_DOT) || check(T.TOK_QUESTIONDOT)) { advance(); if (check(T.TOK_IDENT)) advance(); else break; }
                  if (check(T.TOK_LPAREN)) scanModuleArgs();
                } else if (check(T.TOK_COMMA) || check(T.TOK_RBRACE)) recordIdentRef(first);
                initPrevNew = false; continue;
              }
              advance(); initPrevNew = false;
            }
          }
        }
      }
    } while (match(T.TOK_COMMA));
  };

  // --- parse_decorators ---
  const parseDecorators = () => {
    const decorators = [];
    while (check(T.TOK_AT) && !check(T.TOK_EOF)) {
      advance();
      if (!check(T.TOK_IDENT)) continue;
      const dec = { name: '', fullName: '', args: [], loc: makeLoc(p.current) };
      const first = p.current; advance();
      dec.name = intern(first);
      let fullName = first.value;
      while (check(T.TOK_DOT)) { advance(); if (check(T.TOK_IDENT)) { fullName += '.' + p.current.value; advance(); } else break; }
      dec.fullName = fullName;
      if (check(T.TOK_LPAREN)) {
        advance();
        let depth = 1;
        let argStart = p.current.offset;
        while (depth > 0 && !check(T.TOK_EOF)) {
          if (check(T.TOK_LPAREN)) depth++;
          else if (check(T.TOK_RPAREN)) { depth--; if (depth === 0) break; }
          else if (check(T.TOK_COMMA) && depth === 1) {
            const arg = source.slice(argStart, p.current.offset);
            if (arg) dec.args.push(arg);
            advance(); argStart = p.current.offset; continue;
          }
          advance();
        }
        const lastArg = source.slice(argStart, p.current.offset);
        if (lastArg) dec.args.push(lastArg);
        if (check(T.TOK_RPAREN)) advance();
      }
      recordIdentRef(first);
      decorators.push(dec);
    }
    return decorators;
  };

  // --- parse_module_expression ---
  const parseModuleExpression = () => {
    let prevWasNew = false, prevWasAwait = false;
    while (check(T.TOK_NEW) || check(T.TOK_AWAIT)) {
      if (check(T.TOK_NEW)) prevWasNew = true;
      if (check(T.TOK_AWAIT)) prevWasAwait = true;
      advance();
    }
    if (!check(T.TOK_IDENT) && !check(T.TOK_MODULE)) {
      while (!check(T.TOK_EOF) && !check(T.TOK_SEMI)) {
        if (check(T.TOK_LBRACE)) { advance(); skipBalanced(T.TOK_LBRACE, T.TOK_RBRACE); }
        else if (check(T.TOK_LPAREN)) { advance(); skipBalanced(T.TOK_LPAREN, T.TOK_RPAREN); }
        else if (check(T.TOK_LBRACKET)) { advance(); skipBalanced(T.TOK_LBRACKET, T.TOK_RBRACKET); }
        else advance();
      }
      return;
    }

    const first = p.current;
    if (isJsxElement(first)) {
      recordCall(first.value, first.value, false, false);
      advance();
      while (!check(T.TOK_EOF) && !check(T.TOK_SEMI)) {
        if (check(T.TOK_LBRACE)) { advance(); skipBalanced(T.TOK_LBRACE, T.TOK_RBRACE); }
        else advance();
      }
      return;
    }

    advance();
    const chain = buildChainWithKeywords(first);

    // CommonJS: module.exports = { name1, name2 } or module.exports = name or exports.name = value
    if (chain.startsWith('exports.') && chain !== 'exports' && check(T.TOK_EQ)) {
      // exports.name = value — mark the assigned value if it's a known name
      advance(); // skip =
      if (check(T.TOK_IDENT)) {
        const name = intern(p.current);
        for (const fn of ast.functions) { if (fn.name === name && fn.module === p.currentModule) fn.flags |= FUNC_EXPORTED; }
        for (const v of ast.variables) { if (v.name === name && v.module === p.currentModule) v.flags |= VAR_EXPORTED; }
        for (const c of ast.classes) { if (c.name === name && c.module === p.currentModule) c.flags |= CLASS_EXPORTED; }
      }
      while (!check(T.TOK_EOF) && !check(T.TOK_SEMI)) advance();
      return;
    }
    if ((chain === 'module.exports' || chain === 'exports') && check(T.TOK_EQ)) {
      advance(); // skip =
      if (check(T.TOK_LBRACE)) {
        advance(); // skip {
        while (!check(T.TOK_RBRACE) && !check(T.TOK_EOF)) {
          if (check(T.TOK_IDENT)) {
            const name = intern(p.current);
            advance();
            // Shorthand { name } or { key: value }
            if (match(T.TOK_COLON)) {
              // { key: value } — skip value
              while (!check(T.TOK_COMMA) && !check(T.TOK_RBRACE) && !check(T.TOK_EOF)) advance();
            }
            // Mark function/variable/class as exported
            for (const fn of ast.functions) { if (fn.name === name && fn.module === p.currentModule) fn.flags |= FUNC_EXPORTED; }
            for (const v of ast.variables) { if (v.name === name && v.module === p.currentModule) v.flags |= VAR_EXPORTED; }
            for (const c of ast.classes) { if (c.name === name && c.module === p.currentModule) c.flags |= CLASS_EXPORTED; }
          }
          if (!match(T.TOK_COMMA)) break;
        }
        if (check(T.TOK_RBRACE)) advance();
      } else if (check(T.TOK_IDENT)) {
        // module.exports = singleName
        const name = intern(p.current);
        for (const fn of ast.functions) { if (fn.name === name && fn.module === p.currentModule) fn.flags |= FUNC_EXPORTED; }
        for (const v of ast.variables) { if (v.name === name && v.module === p.currentModule) v.flags |= VAR_EXPORTED; }
        for (const c of ast.classes) { if (c.name === name && c.module === p.currentModule) c.flags |= CLASS_EXPORTED; }
        advance();
      }
      return;
    }

    if (check(T.TOK_LPAREN) || check(T.TOK_LT)) {
      if (check(T.TOK_LT)) {
        let depth = 1; advance();
        while (depth > 0 && !check(T.TOK_EOF)) { if (check(T.TOK_LT)) depth++; else if (check(T.TOK_GT)) depth--; advance(); }
      }
      if (check(T.TOK_LPAREN)) {
        const call = recordCall(first.value, chain, prevWasNew, prevWasAwait);
        p.currentModulePtr.calls.push(call.id);
        const eff = checkSideEffect(chain);
        if (eff !== EFFECT_NONE) {
          addSideEffect(ast, { loc: makeLoc(first), type: eff, apiCall: chain, containingFunc: 0 });
        }
        scanModuleArgs();
      }
    }

    // Chained calls: createRoot(...).render(<Component />)
    while (!check(T.TOK_EOF) && !check(T.TOK_SEMI)) {
      if (check(T.TOK_DOT) || check(T.TOK_QUESTIONDOT)) {
        advance();
        if (check(T.TOK_IDENT)) {
          const method = p.current; advance();
          if (check(T.TOK_LPAREN)) {
            const c = recordCall(method.value, method.value, false, false);
            p.currentModulePtr.calls.push(c.id);
            scanModuleArgs();
          }
        }
      } else if (check(T.TOK_LPAREN)) { advance(); skipBalanced(T.TOK_LPAREN, T.TOK_RPAREN); }
      else if (check(T.TOK_LBRACKET)) { advance(); skipBalanced(T.TOK_LBRACKET, T.TOK_RBRACKET); }
      else if (check(T.TOK_LBRACE)) { advance(); skipBalanced(T.TOK_LBRACE, T.TOK_RBRACE); }
      else advance();
    }
  };

  // --- parse_statement ---
  const parseStatement = () => {
    const decorators = parseDecorators();

    if (check(T.TOK_IMPORT)) {
      const importTok = p.current;
      advance(); // 'import'
      // Dynamic import
      if (check(T.TOK_LPAREN)) {
        advance();
        if (check(T.TOK_STRING)) { recordDynamicImport(importTok, internString(p.current), null, true); advance(); }
        else {
          const es = p.current.offset; let pd = 1;
          while (pd > 0 && !check(T.TOK_EOF)) { if (check(T.TOK_LPAREN)) pd++; else if (check(T.TOK_RPAREN)) pd--; if (pd > 0) advance(); }
          recordDynamicImport(importTok, null, source.slice(es, p.current.offset), false);
        }
        while (!check(T.TOK_EOF) && !check(T.TOK_SEMI) && !check(T.TOK_RBRACE)) advance();
        if (check(T.TOK_SEMI)) advance();
      } else {
        // Static import
        const imp = addImport(ast, { loc: makeLoc(importTok), module: p.currentModule });
        if (match(T.TOK_TYPE)) imp.isTypeOnly = true;

        if (check(T.TOK_STRING)) {
          // import "module"
          imp.source = internString(p.current); advance();
        } else if (match(T.TOK_STAR)) {
          consume(T.TOK_AS, "Expected 'as'");
          const spec = { imported: '', local: '', isDefault: false, isNamespace: true, isTypeOnly: false };
          if (check(T.TOK_IDENT)) { spec.local = intern(p.current); advance(); }
          imp.specifiers.push(spec);
          consume(T.TOK_FROM, "Expected 'from'");
          if (check(T.TOK_STRING)) { imp.source = internString(p.current); advance(); }
        } else if (check(T.TOK_IDENT)) {
          // Default import
          const spec = { imported: intern(p.current), local: intern(p.current), isDefault: true, isNamespace: false, isTypeOnly: false };
          imp.specifiers.push(spec); advance();

          if (match(T.TOK_COMMA)) {
            if (check(T.TOK_STAR)) {
              advance(); consume(T.TOK_AS, "Expected 'as'");
              const nsSpec = { imported: '', local: '', isDefault: false, isNamespace: true, isTypeOnly: false };
              if (check(T.TOK_IDENT)) { nsSpec.local = intern(p.current); advance(); }
              imp.specifiers.push(nsSpec);
            } else if (check(T.TOK_LBRACE)) {
              advance();
              parseNamedImports(imp);
              consume(T.TOK_RBRACE, "Expected '}'");
            }
          }
          consume(T.TOK_FROM, "Expected 'from'");
          if (check(T.TOK_STRING)) { imp.source = internString(p.current); advance(); }
        } else if (check(T.TOK_LBRACE)) {
          advance();
          parseNamedImports(imp);
          consume(T.TOK_RBRACE, "Expected '}'");
          consume(T.TOK_FROM, "Expected 'from'");
          if (check(T.TOK_STRING)) { imp.source = internString(p.current); advance(); }
        }

        p.currentModulePtr.imports.push(imp.id);
      }
    }
    else if (check(T.TOK_EXPORT)) {
      const exp = parseExportDecl();
      p.currentModulePtr.exports.push(exp.id);
    }
    else if (check(T.TOK_FUNCTION)) {
      advance();
      const func = parseFunction(0);
      p.currentModulePtr.functions.push(func.id);
    }
    else if (check(T.TOK_ASYNC)) {
      advance();
      if (match(T.TOK_FUNCTION)) {
        const func = parseFunction(FUNC_ASYNC);
        p.currentModulePtr.functions.push(func.id);
      }
    }
    else if (check(T.TOK_CLASS)) {
      const cls = parseClass(0);
      cls.decorators = decorators;
      p.currentModulePtr.classes.push(cls.id);
    }
    else if (check(T.TOK_CONST) || check(T.TOK_LET) || check(T.TOK_VAR)) {
      parseDeclaration(false);
    }
    else if (check(T.TOK_INTERFACE)) {
      advance();
      if (check(T.TOK_IDENT)) {
        const iface = addInterface(ast, { name: intern(p.current), loc: makeLoc(p.current), module: p.currentModule });
        advance();
        iface.typeParams = parseTypeParams();
        if (match(T.TOK_EXTENDS)) { do { if (check(T.TOK_IDENT)) { iface.extends.push(intern(p.current)); advance(); } if (check(T.TOK_LT)) skipBalanced(T.TOK_LT, T.TOK_GT); } while (match(T.TOK_COMMA)); }
        if (match(T.TOK_LBRACE)) scanInterfaceBody();
        p.currentModulePtr.interfaces.push(iface.id);
      }
    }
    else if (check(T.TOK_TYPE)) {
      advance();
      if (check(T.TOK_IDENT)) {
        const ta = addTypeAlias(ast, { name: intern(p.current), loc: makeLoc(p.current), module: p.currentModule });
        advance();
        ta.typeParams = parseTypeParams();
        consume(T.TOK_EQ, "Expected '=' in type alias");
        ta.definition = parseTypeAnnotation();
        scanTypeForRefs(ta.definition);
        p.currentModulePtr.typeAliases.push(ta.id);
      }
    }
    else if (check(T.TOK_ENUM)) {
      advance();
      if (check(T.TOK_IDENT)) advance();
      if (match(T.TOK_LBRACE)) skipBalanced(T.TOK_LBRACE, T.TOK_RBRACE);
    }
    else if (check(T.TOK_DECLARE)) {
      advance();
      while (!check(T.TOK_EOF) && !check(T.TOK_SEMI)) {
        if (check(T.TOK_LBRACE)) { advance(); skipBalanced(T.TOK_LBRACE, T.TOK_RBRACE); break; }
        advance();
      }
    }
    else if (check(T.TOK_IDENT) || check(T.TOK_NEW) || check(T.TOK_AWAIT) || check(T.TOK_MODULE)) {
      parseModuleExpression();
    }
    else advance();

    match(T.TOK_SEMI);
  };

  // --- Named imports helper ---
  const parseNamedImports = (imp) => {
    while (!check(T.TOK_RBRACE) && !check(T.TOK_EOF)) {
      const spec = { imported: '', local: '', isDefault: false, isNamespace: false, isTypeOnly: false };
      if (match(T.TOK_TYPE)) spec.isTypeOnly = true;
      if (check(T.TOK_IDENT) || check(T.TOK_DEFAULT) || check(T.TOK_INFER)) {
        spec.imported = intern(p.current); advance();
        if (match(T.TOK_AS)) { if (check(T.TOK_IDENT)) { spec.local = intern(p.current); advance(); } }
        else spec.local = spec.imported;
        imp.specifiers.push(spec);
      } else if (!match(T.TOK_COMMA)) {
        advance(); // skip unexpected token to prevent infinite loop
        continue;
      }
      match(T.TOK_COMMA);
    }
  };

  // --- Main parse ---
  advance(); // Prime parser

  const mod = addModule(ast, filePath);
  p.currentModule = mod.id;
  p.currentModulePtr = mod;

  while (!check(T.TOK_EOF)) {
    parseStatement();
    if (p.panicMode) synchronize();
  }

  return { ast, module: mod, hadError: p.hadError, errorMsg: p.errorMsg };
};
