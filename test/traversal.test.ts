import { describe, test, expect, beforeEach } from "bun:test";
import { handleRequest, _reset, loadModules } from "../src/mcp";
import recall from "../src/modules/recall";
import patterns from "../src/modules/patterns";

const rpc = (method: string, params?: unknown) =>
  handleRequest({ jsonrpc: "2.0", id: 1, method, params });

const callTool = async (name: string, args: Record<string, unknown>) => {
  const res = await rpc("tools/call", { name, arguments: args });
  return JSON.parse((res.result as any).content[0].text);
};

// Helper to build a call graph:
//   main -> server -> handler -> db
//                  -> auth -> db
//   utils (disconnected)
async function buildCallGraph() {
  await callTool("patterns_add_node", { id: "main", type: "function", name: "main" });
  await callTool("patterns_add_node", { id: "server", type: "function", name: "serve" });
  await callTool("patterns_add_node", { id: "handler", type: "function", name: "handleRequest" });
  await callTool("patterns_add_node", { id: "auth", type: "function", name: "authenticate" });
  await callTool("patterns_add_node", { id: "db", type: "module", name: "database" });
  await callTool("patterns_add_node", { id: "utils", type: "module", name: "utils" });

  await callTool("patterns_add_edge", { from: "main", to: "server", relationship: "calls" });
  await callTool("patterns_add_edge", { from: "server", to: "handler", relationship: "calls" });
  await callTool("patterns_add_edge", { from: "server", to: "auth", relationship: "calls" });
  await callTool("patterns_add_edge", { from: "handler", to: "db", relationship: "calls" });
  await callTool("patterns_add_edge", { from: "auth", to: "db", relationship: "calls" });
}

beforeEach(async () => {
  _reset();
  await loadModules([recall(), patterns()]);
});

describe("patterns_neighbors", () => {
  test("registers tool", async () => {
    const res = await rpc("tools/list");
    const names = (res.result as any).tools.map((t: any) => t.name);
    expect(names).toContain("patterns_neighbors");
  });

  test("returns outgoing neighbors", async () => {
    await buildCallGraph();
    const result = await callTool("patterns_neighbors", { id: "server", direction: "outgoing" });
    const ids = result.nodes.map((n: any) => n.id);
    expect(ids).toContain("handler");
    expect(ids).toContain("auth");
    expect(ids).not.toContain("main");
    expect(result.count).toBe(2);
  });

  test("returns incoming neighbors", async () => {
    await buildCallGraph();
    const result = await callTool("patterns_neighbors", { id: "db", direction: "incoming" });
    const ids = result.nodes.map((n: any) => n.id);
    expect(ids).toContain("handler");
    expect(ids).toContain("auth");
    expect(result.count).toBe(2);
  });

  test("both direction returns all connected", async () => {
    await buildCallGraph();
    const result = await callTool("patterns_neighbors", { id: "server" });
    const ids = result.nodes.map((n: any) => n.id);
    expect(ids).toContain("main");    // incoming
    expect(ids).toContain("handler"); // outgoing
    expect(ids).toContain("auth");    // outgoing
    expect(result.count).toBe(3);
  });

  test("filters by relationship", async () => {
    await callTool("patterns_add_node", { id: "a", type: "file", name: "a.ts" });
    await callTool("patterns_add_node", { id: "b", type: "file", name: "b.ts" });
    await callTool("patterns_add_node", { id: "c", type: "file", name: "c.ts" });
    await callTool("patterns_add_edge", { from: "a", to: "b", relationship: "imports" });
    await callTool("patterns_add_edge", { from: "a", to: "c", relationship: "extends" });

    const result = await callTool("patterns_neighbors", { id: "a", direction: "outgoing", relationship: "imports" });
    expect(result.count).toBe(1);
    expect(result.nodes[0].id).toBe("b");
  });

  test("returns empty for disconnected node", async () => {
    await buildCallGraph();
    const result = await callTool("patterns_neighbors", { id: "utils", direction: "outgoing" });
    expect(result.count).toBe(0);
  });
});

describe("patterns_traverse", () => {
  test("registers tool", async () => {
    const res = await rpc("tools/list");
    const names = (res.result as any).tools.map((t: any) => t.name);
    expect(names).toContain("patterns_traverse");
  });

  test("BFS from main finds all reachable nodes", async () => {
    await buildCallGraph();
    const result = await callTool("patterns_traverse", { startId: "main" });
    const ids = result.nodes.map((n: any) => n.id);
    expect(ids).toContain("main");
    expect(ids).toContain("server");
    expect(ids).toContain("handler");
    expect(ids).toContain("auth");
    expect(ids).toContain("db");
    expect(ids).not.toContain("utils"); // disconnected
    expect(result.edges.length).toBeGreaterThanOrEqual(5);
  });

  test("DFS from main also finds all reachable", async () => {
    await buildCallGraph();
    const result = await callTool("patterns_traverse", { startId: "main", mode: "dfs" });
    const ids = result.nodes.map((n: any) => n.id);
    expect(ids).toContain("db");
    expect(ids).not.toContain("utils");
  });

  test("respects maxDepth", async () => {
    await buildCallGraph();
    const result = await callTool("patterns_traverse", { startId: "main", maxDepth: 1 });
    const ids = result.nodes.map((n: any) => n.id);
    expect(ids).toContain("main");
    expect(ids).toContain("server");
    expect(ids).not.toContain("handler"); // depth 2
    expect(ids).not.toContain("db");      // depth 3
  });

  test("incoming traversal walks backwards", async () => {
    await buildCallGraph();
    const result = await callTool("patterns_traverse", { startId: "db", direction: "incoming" });
    const ids = result.nodes.map((n: any) => n.id);
    expect(ids).toContain("db");
    expect(ids).toContain("handler");
    expect(ids).toContain("auth");
    expect(ids).toContain("server");
    expect(ids).toContain("main");
  });

  test("filters by relationship type", async () => {
    await callTool("patterns_add_node", { id: "a", type: "file", name: "a.ts" });
    await callTool("patterns_add_node", { id: "b", type: "file", name: "b.ts" });
    await callTool("patterns_add_node", { id: "c", type: "file", name: "c.ts" });
    await callTool("patterns_add_edge", { from: "a", to: "b", relationship: "imports" });
    await callTool("patterns_add_edge", { from: "b", to: "c", relationship: "extends" });

    const result = await callTool("patterns_traverse", { startId: "a", relationship: "imports" });
    const ids = result.nodes.map((n: any) => n.id);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(ids).not.toContain("c"); // c is connected via "extends", not "imports"
  });

  test("handles cycles without infinite loop", async () => {
    await callTool("patterns_add_node", { id: "x", type: "fn", name: "x" });
    await callTool("patterns_add_node", { id: "y", type: "fn", name: "y" });
    await callTool("patterns_add_edge", { from: "x", to: "y", relationship: "calls" });
    await callTool("patterns_add_edge", { from: "y", to: "x", relationship: "calls" });

    const result = await callTool("patterns_traverse", { startId: "x" });
    expect(result.nodes.length).toBe(2);
  });

  test("reports correct depth", async () => {
    await buildCallGraph();
    const result = await callTool("patterns_traverse", { startId: "main" });
    expect(result.depth).toBeGreaterThanOrEqual(3); // main -> server -> handler/auth -> db
  });

  test("single disconnected node returns just itself", async () => {
    await buildCallGraph();
    const result = await callTool("patterns_traverse", { startId: "utils" });
    expect(result.nodes.length).toBe(1);
    expect(result.nodes[0].id).toBe("utils");
    expect(result.edges.length).toBe(0);
  });
});

describe("patterns_shortest_path", () => {
  test("registers tool", async () => {
    const res = await rpc("tools/list");
    const names = (res.result as any).tools.map((t: any) => t.name);
    expect(names).toContain("patterns_shortest_path");
  });

  test("finds direct path", async () => {
    await buildCallGraph();
    const result = await callTool("patterns_shortest_path", { fromId: "main", toId: "server" });
    expect(result.length).toBe(1);
    expect(result.nodes.length).toBe(2);
    expect(result.nodes[0].id).toBe("main");
    expect(result.nodes[1].id).toBe("server");
  });

  test("finds multi-hop path", async () => {
    await buildCallGraph();
    const result = await callTool("patterns_shortest_path", { fromId: "main", toId: "db" });
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.length).toBeLessThanOrEqual(3);
    expect(result.nodes[0].id).toBe("main");
    expect(result.nodes[result.nodes.length - 1].id).toBe("db");
  });

  test("returns -1 length when no path exists", async () => {
    await buildCallGraph();
    const result = await callTool("patterns_shortest_path", { fromId: "main", toId: "utils" });
    expect(result.length).toBe(-1);
    expect(result.nodes.length).toBe(0);
  });

  test("path to self has length 0", async () => {
    await buildCallGraph();
    const result = await callTool("patterns_shortest_path", { fromId: "main", toId: "main" });
    expect(result.length).toBe(0);
    expect(result.nodes.length).toBe(1);
    expect(result.nodes[0].id).toBe("main");
  });

  test("respects direction constraint", async () => {
    await buildCallGraph();
    // main -> server -> handler, so outgoing-only from handler to main should fail
    const result = await callTool("patterns_shortest_path", { fromId: "handler", toId: "main", direction: "outgoing" });
    expect(result.length).toBe(-1);
  });

  test("filters by relationship", async () => {
    await callTool("patterns_add_node", { id: "a", type: "file", name: "a.ts" });
    await callTool("patterns_add_node", { id: "b", type: "file", name: "b.ts" });
    await callTool("patterns_add_node", { id: "c", type: "file", name: "c.ts" });
    await callTool("patterns_add_edge", { from: "a", to: "b", relationship: "imports" });
    await callTool("patterns_add_edge", { from: "b", to: "c", relationship: "extends" });

    // No imports-only path from a to c (the b->c edge is "extends")
    const result = await callTool("patterns_shortest_path", { fromId: "a", toId: "c", relationship: "imports" });
    expect(result.length).toBe(-1);

    // But without filter, path exists
    const result2 = await callTool("patterns_shortest_path", { fromId: "a", toId: "c" });
    expect(result2.length).toBe(2);
  });

  test("finds shortest among multiple paths", async () => {
    // Diamond: a -> b -> d, a -> c -> d
    await callTool("patterns_add_node", { id: "a", type: "fn", name: "a" });
    await callTool("patterns_add_node", { id: "b", type: "fn", name: "b" });
    await callTool("patterns_add_node", { id: "c", type: "fn", name: "c" });
    await callTool("patterns_add_node", { id: "d", type: "fn", name: "d" });
    await callTool("patterns_add_edge", { from: "a", to: "b", relationship: "calls" });
    await callTool("patterns_add_edge", { from: "a", to: "c", relationship: "calls" });
    await callTool("patterns_add_edge", { from: "b", to: "d", relationship: "calls" });
    await callTool("patterns_add_edge", { from: "c", to: "d", relationship: "calls" });

    const result = await callTool("patterns_shortest_path", { fromId: "a", toId: "d" });
    expect(result.length).toBe(2); // a->b->d or a->c->d, both length 2
  });
});
