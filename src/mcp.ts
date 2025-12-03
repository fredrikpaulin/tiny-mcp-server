/**
 * Tiny MCP server implementation for Bun.
 * Handles JSON-RPC requests and responses.
 * Registers and executes MCP tools.
 * Uses stdio transport for communication.
 * Author: Fredrik Paulin
 * Email: fredrik@rymdskepp.com
 * Date: 2025-12-03
 * Version: 1.0.0
 * License: MIT
 * Copyright: 2025 Fredrik Paulin
 */

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

type ToolHandler = (params: Record<string, unknown>) => Promise<unknown>;

const tools: Map<string, { schema: object; handler: ToolHandler }> = new Map();

export function registerTool(name: string, schema: object, handler: ToolHandler) {
  tools.set(name, { schema, handler });
}

async function handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse> {
  const { id, method, params } = req;

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "st-mcp", version: "1.0.0" },
      },
    };
  }

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: [...tools.entries()].map(([name, { schema }]) => ({
          name,
          inputSchema: schema,
        })),
      },
    };
  }

  if (method === "tools/call") {
    const { name, arguments: args } = params as { name: string; arguments: Record<string, unknown> };
    const tool = tools.get(name);

    if (!tool) {
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${name}` } };
    }

    try {
      const result = await tool.handler(args);
      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(result) }] },
      };
    } catch (e) {
      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify({ isError: true, error: String(e) }) }] },
      };
    }
  }

  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method: ${method}` } };
}

function log(...args: unknown[]) {
  console.error("[mcp]", ...args);
}

export async function serve() {
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk);

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const req = JSON.parse(line) as JsonRpcRequest;
      const res = await handleRequest(req);
      if (req.id !== undefined) {
        console.log(JSON.stringify(res));
      }
    }
  }
}