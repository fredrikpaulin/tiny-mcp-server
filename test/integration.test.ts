import { describe, expect, test } from "bun:test";
import { join } from "path";

const SERVER_PATH = join(import.meta.dir, "..", "examples", "basic.ts");

async function createServer() {
  const proc = Bun.spawn([process.execPath, "run", SERVER_PATH], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const decoder = new TextDecoder();
  const reader = proc.stdout.getReader();
  let buf = "";
  const parsed: any[] = [];

  const send = async (msg: object) => {
    proc.stdin.write(JSON.stringify(msg) + "\n");
    proc.stdin.flush();
  };

  const readLine = async (timeout = 3000): Promise<any> => {
    if (parsed.length) return parsed.shift();

    const timer = setTimeout(() => reader.cancel(), timeout);
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value);

        let nl;
        while ((nl = buf.indexOf("\n")) !== -1) {
          parsed.push(JSON.parse(buf.slice(0, nl)));
          buf = buf.slice(nl + 1);
        }

        if (parsed.length) return parsed.shift();
      }
    } finally {
      clearTimeout(timer);
    }
    throw new Error("No response received");
  };

  // Read messages until we get one with a matching id (the final response)
  const readUntilResponse = async (id: number | string, timeout = 3000): Promise<{ notifications: any[]; response: any }> => {
    const notifications: any[] = [];
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const msg = await readLine(deadline - Date.now());
      if (msg.id === id) return { notifications, response: msg };
      notifications.push(msg);
    }
    throw new Error("No response received");
  };

  const close = () => {
    proc.stdin.end();
    proc.kill();
  };

  return { send, readLine, readUntilResponse, close, proc };
}

describe("stdio transport integration", () => {
  test("initialize handshake", async () => {
    const server = await createServer();
    try {
      await server.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } });
      const res = await server.readLine();
      expect(res.jsonrpc).toBe("2.0");
      expect(res.id).toBe(1);
      expect(res.result.serverInfo.name).toBe("tiny-mcp-server");
      expect(res.result.capabilities).toBeDefined();
    } finally {
      server.close();
    }
  });

  test("ping over stdio", async () => {
    const server = await createServer();
    try {
      await server.send({ jsonrpc: "2.0", id: 1, method: "ping" });
      const res = await server.readLine();
      expect(res.result).toEqual({});
    } finally {
      server.close();
    }
  });

  test("tools/list returns registered tools", async () => {
    const server = await createServer();
    try {
      await server.send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
      const res = await server.readLine();
      const names = res.result.tools.map((t: any) => t.name);
      expect(names).toContain("echo");
      expect(names).toContain("summarize");
    } finally {
      server.close();
    }
  });

  test("tools/call executes echo tool", async () => {
    const server = await createServer();
    try {
      await server.send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "echo", arguments: { message: "hello" } },
      });
      const res = await server.readLine();
      const parsed = JSON.parse(res.result.content[0].text);
      expect(parsed).toEqual({ echoed: "hello" });
    } finally {
      server.close();
    }
  });

  test("resources/list returns resources and templates", async () => {
    const server = await createServer();
    try {
      await server.send({ jsonrpc: "2.0", id: 1, method: "resources/list" });
      const res = await server.readLine();
      expect(res.result.resources.length).toBeGreaterThan(0);
      expect(res.result.resourceTemplates.length).toBeGreaterThan(0);
    } finally {
      server.close();
    }
  });

  test("resources/read reads static resource", async () => {
    const server = await createServer();
    try {
      await server.send({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: { uri: "info://server" },
      });
      const res = await server.readLine();
      const text = res.result.contents[0].text;
      expect(JSON.parse(text)).toEqual({ name: "tiny-mcp-server", version: "0.0.1" });
    } finally {
      server.close();
    }
  });

  test("multiple sequential requests on same connection", async () => {
    const server = await createServer();
    try {
      await server.send({ jsonrpc: "2.0", id: 1, method: "ping" });
      const r1 = await server.readLine();
      expect(r1.id).toBe(1);

      await server.send({ jsonrpc: "2.0", id: 2, method: "ping" });
      const r2 = await server.readLine();
      expect(r2.id).toBe(2);

      await server.send({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "echo", arguments: { message: "third" } },
      });
      const r3 = await server.readLine();
      expect(r3.id).toBe(3);
    } finally {
      server.close();
    }
  });

  test("unknown method returns error over stdio", async () => {
    const server = await createServer();
    try {
      await server.send({ jsonrpc: "2.0", id: 1, method: "bogus/method" });
      const res = await server.readLine();
      expect(res.error).toBeDefined();
      expect(res.error.code).toBe(-32601);
    } finally {
      server.close();
    }
  });

  test("validation error over stdio for missing required field", async () => {
    const server = await createServer();
    try {
      await server.send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "echo", arguments: {} },
      });
      const res = await server.readLine();
      const parsed = JSON.parse(res.result.content[0].text);
      expect(parsed.isError).toBe(true);
      expect(parsed.code).toBe("validation_failed");
      expect(parsed.errors.length).toBeGreaterThan(0);
      expect(parsed.errors[0].path).toBe("message");
    } finally {
      server.close();
    }
  });

  test("validation passes and tool executes over stdio", async () => {
    const server = await createServer();
    try {
      await server.send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "echo", arguments: { message: "valid" } },
      });
      const res = await server.readLine();
      const parsed = JSON.parse(res.result.content[0].text);
      expect(parsed).toEqual({ echoed: "valid" });
    } finally {
      server.close();
    }
  });

  test("streaming tool sends notifications then final response", async () => {
    const server = await createServer();
    try {
      await server.send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "count", arguments: { n: 3 } },
      });
      const { notifications, response } = await server.readUntilResponse(1);

      // Should have 5 notifications: "1", ",", "2", ",", "3"
      expect(notifications.length).toBe(5);
      for (const n of notifications) {
        expect(n.method).toBe("notifications/tools/progress");
        expect(n.id).toBeUndefined();
      }
      expect(notifications.map((n: any) => n.params.text).join("")).toBe("1,2,3");

      // Final response has concatenated text
      expect(response.id).toBe(1);
      expect(response.result.content[0].text).toBe("1,2,3");
    } finally {
      server.close();
    }
  });

  test("streaming tool notifications arrive in order", async () => {
    const server = await createServer();
    try {
      await server.send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "count", arguments: { n: 5 } },
      });
      const { notifications } = await server.readUntilResponse(1);

      const chunks = notifications.map((n: any) => n.params.text);
      expect(chunks).toEqual(["1", ",", "2", ",", "3", ",", "4", ",", "5"]);
    } finally {
      server.close();
    }
  });
});
