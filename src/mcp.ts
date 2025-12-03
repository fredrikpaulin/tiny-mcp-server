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
type ResourceHandler = () => Promise<string>;

const tools: Map<string, { description: string; schema: object; handler: ToolHandler }> = new Map();
const resources: Map<string, { name: string; description: string; mimeType: string; handler: ResourceHandler }> = new Map();

export function registerTool(name: string, description: string, schema: object, handler: ToolHandler) {
  tools.set(name, { description, schema, handler });
}

export function registerResource(uri: string, name: string, description: string, mimeType: string, handler: ResourceHandler) {
  resources.set(uri, { name, description, mimeType, handler });
}

async function handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse> {
  const { id, method, params } = req;

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "st-mcp", version: "1.0.0" },
      },
    };
  }

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: [...tools.entries()].map(([name, { description, schema }]) => ({
          name,
          description,
          inputSchema: schema,
        })),
      },
    };
  }

  if (method === "resources/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        resources: [...resources.entries()].map(([uri, { name, description, mimeType }]) => ({
          uri,
          name,
          description,
          mimeType,
        })),
      },
    };
  }

  if (method === "resources/read") {
    const { uri } = params as { uri: string };
    const resource = resources.get(uri);

    if (!resource) {
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown resource: ${uri}` } };
    }

    try {
      const text = await resource.handler();
      return {
        jsonrpc: "2.0",
        id,
        result: {
          contents: [{ uri, mimeType: resource.mimeType, text }],
        },
      };
    } catch (e) {
      return { jsonrpc: "2.0", id, error: { code: -32603, message: String(e) } };
    }
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