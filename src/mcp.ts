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
type ResourceHandler = () => Promise<string | Uint8Array>;

interface TemplateVars { [key: string]: string }
type ResourceTemplateHandler = (vars: TemplateVars) => Promise<string | Uint8Array>;

const tools: Map<string, { description: string; schema: object; handler: ToolHandler }> = new Map();
const resources: Map<string, { name: string; description: string; mimeType: string; handler: ResourceHandler }> = new Map();
const resourceTemplates: Map<string, { name: string; description: string; mimeType: string; pattern: RegExp; vars: string[]; handler: ResourceTemplateHandler }> = new Map();
const pendingRequests: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }> = new Map();
let requestId = 0;

export function registerTool(name: string, description: string, schema: object, handler: ToolHandler) {
  tools.set(name, { description, schema, handler });
}

export function registerResource(uri: string, name: string, description: string, mimeType: string, handler: ResourceHandler) {
  resources.set(uri, { name, description, mimeType, handler });
}

export function registerResourceTemplate(uriTemplate: string, name: string, description: string, mimeType: string, handler: ResourceTemplateHandler) {
  const vars: string[] = [];
  const pattern = new RegExp("^" + uriTemplate.replace(/\{([^}]+)\}/g, (_, v) => (vars.push(v), "(.+)")) + "$");
  resourceTemplates.set(uriTemplate, { name, description, mimeType, pattern, vars, handler });
}

interface ServerOptions {
  name?: string;
  version?: string;
}

let serverInfo = { name: "mcp-server", version: "1.0.0" };

function formatResourceContent(uri: string, mimeType: string, data: string | Uint8Array) {
  if (typeof data === "string") {
    return { uri, mimeType, text: data };
  }
  return { uri, mimeType, blob: Buffer.from(data).toString("base64") };
}

async function handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse> {
  const { id, method, params } = req;

  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }

  if (method === "initialize") {
    const { protocolVersion } = (params || {}) as { protocolVersion?: string };
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: protocolVersion || "2025-11-25",
        capabilities: { tools: {}, resources: {}, sampling: {} },
        serverInfo: { name: serverInfo.name, version: serverInfo.version },
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
        resourceTemplates: [...resourceTemplates.entries()].map(([uriTemplate, { name, description, mimeType }]) => ({
          uriTemplate,
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

    if (resource) {
      try {
        const data = await resource.handler();
        return {
          jsonrpc: "2.0",
          id,
          result: { contents: [formatResourceContent(uri, resource.mimeType, data)] },
        };
      } catch (e) {
        return { jsonrpc: "2.0", id, error: { code: -32603, message: String(e) } };
      }
    }

    for (const [, template] of resourceTemplates) {
      const match = uri.match(template.pattern);
      if (match) {
        const vars: Record<string, string> = {};
        template.vars.forEach((v, i) => (vars[v] = match[i + 1] ?? ""));
        try {
          const data = await template.handler(vars);
          return {
            jsonrpc: "2.0",
            id,
            result: { contents: [formatResourceContent(uri, template.mimeType, data)] },
          };
        } catch (e) {
          return { jsonrpc: "2.0", id, error: { code: -32603, message: String(e) } };
        }
      }
    }

    return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown resource: ${uri}` } };
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

function sendRequest(method: string, params: unknown): Promise<unknown> {
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    console.log(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  });
}

export interface SampleMessage {
  role: "user" | "assistant";
  content: { type: "text"; text: string };
}

export interface SampleOptions {
  messages: SampleMessage[];
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export async function sample(options: SampleOptions): Promise<string> {
  const result = await sendRequest("sampling/createMessage", {
    messages: options.messages,
    maxTokens: options.maxTokens || 1000,
    ...(options.temperature !== undefined && { temperature: options.temperature }),
    ...(options.systemPrompt && { systemPrompt: options.systemPrompt }),
  }) as { content: { type: string; text: string } };
  return result.content.text;
}

export async function serve(options: ServerOptions = {}) {
  serverInfo = {
    name: options.name || "mcp-server",
    version: options.version || "1.0.0",
  };
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk);

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);

        // Response to our outgoing request
        if ("result" in msg || "error" in msg) {
          const pending = pendingRequests.get(msg.id);
          if (pending) {
            pendingRequests.delete(msg.id);
            if (msg.error) {
              pending.reject(new Error(msg.error.message));
            } else {
              pending.resolve(msg.result);
            }
          }
          continue;
        }

        // Incoming request
        const req = msg as JsonRpcRequest;
        const res = await handleRequest(req);
        if (req.id !== undefined) {
          console.log(JSON.stringify(res));
        }
      } catch (e) {
        log("Parse error:", e);
      }
    }
  }
}