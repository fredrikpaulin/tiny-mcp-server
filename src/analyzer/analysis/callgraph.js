// Call graph — ported from Skeleton-ts src/analysis/callgraph.c
// Builds caller→callee edges, marks entry points, BFS reachability

import { FUNC_EXPORTED, CLASS_EXPORTED } from '../ast.js';
import { SYM_FUNCTION, resolveSymbol, lookupSymbol } from './symbols.js';

export const createCallGraph = () => ({
  nodes: new Map(),        // funcId → CallGraphNode
  entryPoints: [],         // funcId[]
  unreachable: [],         // funcId[]
  allFunctions: [],        // funcId[]
});

const getOrCreateNode = (cg, funcId) => {
  let node = cg.nodes.get(funcId);
  if (!node) {
    node = { functionId: funcId, outgoing: [], incoming: [], isEntryPoint: false, isReachable: false };
    cg.nodes.set(funcId, node);
    cg.allFunctions.push(funcId);
  }
  return node;
};

// Build call graph edges from AST calls resolved through symbol table
export const buildCallGraph = (cg, ast, st) => {
  // Create nodes for all functions
  for (const func of ast.functions) {
    getOrCreateNode(cg, func.id);
  }

  // Process calls in each function
  for (const func of ast.functions) {
    const callerNode = cg.nodes.get(func.id);
    if (!callerNode) continue;

    for (const callId of func.calls) {
      const call = ast.calls.find(c => c.id === callId);
      if (!call || !call.callee) continue;

      // Resolve callee through imports, then fallback to simple lookup
      let sym = resolveSymbol(st, func.module, call.callee, ast);
      if (!sym) sym = lookupSymbol(st, call.callee);

      const edge = {
        caller: func.id,
        callee: 0,
        callSite: call.loc,
        isResolved: false,
      };

      if (sym && sym.kind === SYM_FUNCTION) {
        edge.callee = sym.nodeId;
        edge.isResolved = true;
        sym.useCount++;

        // Add incoming edge to callee
        const calleeNode = cg.nodes.get(sym.nodeId);
        if (calleeNode) calleeNode.incoming.push({ ...edge });
      }

      callerNode.outgoing.push(edge);
    }
  }
};

// Mark exported functions, methods of exported classes, and module-level call targets as entry points
export const markEntryPoints = (cg, ast, st) => {
  for (const func of ast.functions) {
    // Exported functions
    if (func.flags & FUNC_EXPORTED) {
      const node = cg.nodes.get(func.id);
      if (node && !node.isEntryPoint) {
        node.isEntryPoint = true;
        cg.entryPoints.push(func.id);
      }
    }

    // Methods of exported classes
    if (func.parentClass) {
      const cls = ast.classes.find(c => c.id === func.parentClass);
      if (cls && (cls.flags & CLASS_EXPORTED)) {
        const node = cg.nodes.get(func.id);
        if (node && !node.isEntryPoint) {
          node.isEntryPoint = true;
          cg.entryPoints.push(func.id);
        }
      }
    }
  }

  // Module-level calls → their resolved targets are entry points
  for (const mod of ast.modules) {
    for (const callId of mod.calls) {
      const call = ast.calls.find(c => c.id === callId);
      if (!call || !call.callee) continue;

      let sym = resolveSymbol(st, mod.id, call.callee, ast);
      if (!sym) sym = lookupSymbol(st, call.callee);

      if (sym && sym.kind === SYM_FUNCTION) {
        const node = cg.nodes.get(sym.nodeId);
        if (node && !node.isEntryPoint) {
          node.isEntryPoint = true;
          cg.entryPoints.push(sym.nodeId);
        }
      }
    }
  }
};

// BFS from entry points to determine reachable functions
export const computeReachability = (cg) => {
  // Reset
  for (const node of cg.nodes.values()) {
    node.isReachable = false;
  }

  const queue = [];
  const visited = new Set();

  // Seed with entry points
  for (const id of cg.entryPoints) {
    if (!visited.has(id)) {
      visited.add(id);
      const node = cg.nodes.get(id);
      if (node) {
        node.isReachable = true;
        queue.push(id);
      }
    }
  }

  // BFS
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const node = cg.nodes.get(current);
    if (!node) continue;

    for (const edge of node.outgoing) {
      if (!edge.isResolved || !edge.callee) continue;
      if (visited.has(edge.callee)) continue;

      visited.add(edge.callee);
      const callee = cg.nodes.get(edge.callee);
      if (callee) {
        callee.isReachable = true;
        queue.push(edge.callee);
      }
    }
  }

  // Collect unreachable
  cg.unreachable = [];
  for (const id of cg.allFunctions) {
    const node = cg.nodes.get(id);
    if (node && !node.isReachable) {
      cg.unreachable.push(id);
    }
  }
};

export const isReachable = (cg, funcId) => {
  const node = cg.nodes.get(funcId);
  return node ? node.isReachable : false;
};

export const getNode = (cg, funcId) => cg.nodes.get(funcId) ?? null;
