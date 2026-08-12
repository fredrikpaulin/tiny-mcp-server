import { describe, expect, test } from "bun:test";
import { join } from "path";

const SERVER = join(import.meta.dir, "fixtures", "sampling-server.ts");

// Speaks to the fixture server over stdio. The fixture's `ask` tool issues a
// sampling request; these tests never answer it, because a tool that samples
// cannot complete over stdio today (see #013) — the point here is that it fails
// cleanly and promptly instead of hanging forever.
function client(requestTimeout: number) {
  const proc = Bun.spawn([process.execPath, "run", SERVER], {
    stdin: "pipe", stdout: "pipe", stderr: "pipe",
    env: { ...process.env, REQUEST_TIMEOUT: String(requestTimeout) },
  });

  const decoder = new TextDecoder();
  const reader = proc.stdout.getReader();
  let buf = "";
  const queue: any[] = [];

  const send = (msg: object) => { proc.stdin.write(JSON.stringify(msg) + "\n"); proc.stdin.flush(); };

  const nextMessage = async (timeout: number): Promise<any | null> => {
    if (queue.length) return queue.shift();
    const timer = setTimeout(() => reader.cancel(), timeout);
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) return null;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) queue.push(JSON.parse(line));
        }
        if (queue.length) return queue.shift();
      }
    } catch { return null; } finally { clearTimeout(timer); }
  };

  // Returns the response for `id`, skipping notifications and the server's own
  // outgoing sampling request. null if nothing arrives within the budget.
  const responseFor = async (id: number, budget: number): Promise<any | null> => {
    const deadline = Date.now() + budget;
    while (Date.now() < deadline) {
      const msg = await nextMessage(deadline - Date.now());
      if (!msg) return null;
      if (msg.id === id && (msg.result !== undefined || msg.error !== undefined)) return msg;
    }
    return null;
  };

  return {
    call: (id: number, name: string, args: object) => send({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
    responseFor,
    close: () => { proc.stdin.end(); proc.kill(); },
  };
}

const payload = (res: any) => JSON.parse(res.result.content[0].text);

describe("outgoing request timeout", () => {
  test("a request the client never answers fails instead of hanging", async () => {
    const c = client(250);
    try {
      c.call(1, "ask", { text: "hello" });
      const res = await c.responseFor(1, 5000);
      expect(res).not.toBeNull();

      const out = payload(res);
      expect(out.isError).toBe(true);
      expect(out.code).toBe("request_timeout");
      expect(out.error).toContain("sampling/createMessage");
      expect(out.error).toContain("250ms");
    } finally { c.close(); }
  }, 15_000);

  test("the timeout fires on roughly its configured deadline", async () => {
    const c = client(400);
    try {
      const started = Date.now();
      c.call(1, "ask", { text: "hello" });
      const res = await c.responseFor(1, 5000);
      const elapsed = Date.now() - started;

      expect(payload(res).code).toBe("request_timeout");
      expect(elapsed).toBeGreaterThanOrEqual(350);
      expect(elapsed).toBeLessThan(3000);
    } finally { c.close(); }
  }, 15_000);

  test("the server keeps serving after a request has timed out", async () => {
    const c = client(250);
    try {
      c.call(1, "ask", { text: "first" });
      expect(payload(await c.responseFor(1, 5000)).code).toBe("request_timeout");

      // A leaked pendingRequests entry or an uncleared timer would show up as a
      // dead or misbehaving server here.
      c.call(2, "echo", { text: "still alive" });
      expect(payload(await c.responseFor(2, 5000)).echoed).toBe("still alive");

      c.call(3, "ask", { text: "second" });
      expect(payload(await c.responseFor(3, 5000)).code).toBe("request_timeout");
    } finally { c.close(); }
  }, 20_000);

  test("requestTimeout defaults to off, so a request waits indefinitely", async () => {
    const c = client(0);
    try {
      c.call(1, "ask", { text: "hello" });
      // No deadline configured, so nothing should come back at all.
      expect(await c.responseFor(1, 1200)).toBeNull();
    } finally { c.close(); }
  }, 15_000);

  test("a tool that does not sample is unaffected by the setting", async () => {
    const c = client(250);
    try {
      c.call(1, "echo", { text: "no sampling here" });
      const out = payload(await c.responseFor(1, 5000));
      expect(out.echoed).toBe("no sampling here");
      expect(out.isError).toBeUndefined();
    } finally { c.close(); }
  }, 15_000);
});
