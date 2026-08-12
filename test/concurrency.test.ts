import { describe, expect, test } from "bun:test";
import { join } from "path";

const FIXTURE = join(import.meta.dir, "fixtures", "sampling-server.ts");
const BASIC = join(import.meta.dir, "..", "examples", "basic.ts");

// A client that reads every message the server emits and can answer sampling
// requests. Unlike the serial-era helpers, this never assumes responses arrive in
// the order the requests were sent.
function connect(server: string, env: Record<string, string> = {}) {
  const proc = Bun.spawn([process.execPath, "run", server], {
    stdin: "pipe", stdout: "pipe", stderr: "pipe",
    env: { ...process.env, ...env },
  });

  const decoder = new TextDecoder();
  const reader = proc.stdout.getReader();
  let buf = "";
  const seen: any[] = [];
  let answerSampling: ((req: any) => object | null) | null = null;

  const send = (msg: object) => { proc.stdin.write(JSON.stringify(msg) + "\n"); proc.stdin.flush(); };

  // Pumps until `done` is satisfied by the messages collected so far.
  const pumpUntil = async <T>(done: () => T | undefined, budget = 6000): Promise<T> => {
    const found = done();
    if (found !== undefined) return found;
    const deadline = Date.now() + budget;
    const timer = setTimeout(() => reader.cancel(), budget);
    try {
      while (Date.now() < deadline) {
        const { value, done: eof } = await reader.read();
        if (eof) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const msg = JSON.parse(line);
          seen.push(msg);
          if (msg.method === "sampling/createMessage" && answerSampling) {
            const reply = answerSampling(msg);
            if (reply) send({ jsonrpc: "2.0", id: msg.id, ...reply });
          }
        }
        const hit = done();
        if (hit !== undefined) return hit;
      }
    } finally { clearTimeout(timer); }
    throw new Error(`timed out; saw ${JSON.stringify(seen).slice(0, 400)}`);
  };

  return {
    send,
    seen,
    onSampling: (fn: (req: any) => object | null) => { answerSampling = fn; },
    // The response for one id, whenever it turns up.
    response: (id: number) => pumpUntil(() => seen.find(m => m.id === id && (m.result !== undefined || m.error !== undefined))),
    // The order ids completed in, once `count` of them have.
    completionOrder: async (count: number) => {
      await pumpUntil(() => {
        const done = seen.filter(m => m.result !== undefined || m.error !== undefined);
        return done.length >= count ? done : undefined;
      });
      return seen.filter(m => m.result !== undefined || m.error !== undefined).map(m => m.id);
    },
    notifications: (method: string) => seen.filter(m => m.method === method),
    pumpUntil,
    close: () => { proc.stdin.end(); proc.kill(); },
  };
}

const payload = (res: any) => JSON.parse(res.result.content[0].text);

describe("sampling over stdio", () => {
  test("a tool that samples completes when the client answers", async () => {
    const c = connect(FIXTURE);
    c.onSampling(() => ({ result: { content: { type: "text", text: "a short summary" } } }));
    try {
      c.send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ask", arguments: { text: "hello" } } });
      const out = payload(await c.response(1));
      expect(out.reply).toBe("a short summary");
      expect(out.isError).toBeUndefined();
    } finally { c.close(); }
  }, 20_000);

  test("a client error reply surfaces as the tool's error, not a timeout", async () => {
    const c = connect(FIXTURE, { REQUEST_TIMEOUT: "5000" });
    c.onSampling(() => ({ error: { code: -32000, message: "client refused" } }));
    try {
      c.send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ask", arguments: { text: "hello" } } });
      const out = payload(await c.response(1));
      expect(out.isError).toBe(true);
      expect(out.error).toContain("client refused");
      expect(out.code).not.toBe("request_timeout");
    } finally { c.close(); }
  }, 20_000);

  test("the reader stays live while a sampling tool waits", async () => {
    const c = connect(FIXTURE, { REQUEST_TIMEOUT: "5000" });
    // Hold the sampling request open until the second call has been answered.
    let held: any = null;
    c.onSampling((req) => { held = req; return null; });
    try {
      c.send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ask", arguments: { text: "waiting" } } });
      await c.pumpUntil(() => (held ? true : undefined));

      // This is the assertion that was impossible before: input is still read.
      c.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "echo", arguments: { text: "got through" } } });
      expect(payload(await c.response(2)).echoed).toBe("got through");

      // And the held request still completes once answered.
      c.send({ jsonrpc: "2.0", id: held.id, result: { content: { type: "text", text: "late but present" } } });
      expect(payload(await c.response(1)).reply).toBe("late but present");
    } finally { c.close(); }
  }, 20_000);

  test("examples/basic.ts summarize works end to end", async () => {
    const c = connect(BASIC);
    c.onSampling((req) => {
      expect(req.params.messages[0].content.text).toContain("Summarize this in one sentence");
      return { result: { content: { type: "text", text: "It is about horses." } } };
    });
    try {
      c.send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "summarize", arguments: { text: "A long text about horses." } } });
      expect(payload(await c.response(1)).summary).toBe("It is about horses.");
    } finally { c.close(); }
  }, 20_000);
});

describe("concurrent request handling", () => {
  test("a fast request overtakes a slow one, both correctly correlated", async () => {
    const c = connect(FIXTURE);
    try {
      c.send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "slow", arguments: { ms: 400 } } });
      c.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "echo", arguments: { text: "quick" } } });

      const order = await c.completionOrder(2);
      expect(order).toEqual([2, 1]);
      expect(payload(await c.response(2)).echoed).toBe("quick");
      expect(payload(await c.response(1)).slept).toBe(400);
    } finally { c.close(); }
  }, 20_000);

  test("in-flight handlers are capped", async () => {
    const c = connect(FIXTURE, { MAX_IN_FLIGHT: "2" });
    try {
      for (let id = 1; id <= 6; id++) {
        c.send({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "slow", arguments: { ms: 60 } } });
      }
      await c.completionOrder(6);
      const peaks = [1, 2, 3, 4, 5, 6].map(id => payload(c.seen.find(m => m.id === id)).peak);
      expect(Math.max(...peaks)).toBeLessThanOrEqual(2);
      expect(Math.max(...peaks)).toBeGreaterThan(1); // genuinely concurrent, not serial
    } finally { c.close(); }
  }, 30_000);

  test("all six requests are answered exactly once", async () => {
    const c = connect(FIXTURE, { MAX_IN_FLIGHT: "3" });
    try {
      for (let id = 1; id <= 6; id++) {
        c.send({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "slow", arguments: { ms: 30 } } });
      }
      const order = await c.completionOrder(6);
      expect(order.sort((a: number, b: number) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    } finally { c.close(); }
  }, 30_000);

  test("a handler that throws outside the tool try/catch still gets a response", async () => {
    const c = connect(FIXTURE);
    try {
      // No params at all, so destructuring in the tools/call handler throws before
      // its own try block. Serially this logged and sent nothing, hanging the client.
      c.send({ jsonrpc: "2.0", id: 1, method: "tools/call" });
      const res = await c.response(1);
      expect(res.error).toBeDefined();
      expect(res.error.code).toBe(-32603);

      // The server survives it.
      c.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "echo", arguments: { text: "alive" } } });
      expect(payload(await c.response(2)).echoed).toBe("alive");
    } finally { c.close(); }
  }, 20_000);
});

describe("streaming under concurrency", () => {
  test("progress notifications carry the id of the request they belong to", async () => {
    const c = connect(FIXTURE);
    try {
      c.send({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "count", arguments: { n: 3 } } });
      await c.response(7);

      const notes = c.notifications("notifications/tools/progress");
      expect(notes.length).toBe(3);
      expect(notes.every(n => n.params.id === 7)).toBe(true);
      expect(notes.map(n => n.params.text)).toEqual(["1", "2", "3"]);
    } finally { c.close(); }
  }, 20_000);

  test("two streaming tools interleave without their chunks becoming ambiguous", async () => {
    const c = connect(FIXTURE);
    try {
      c.send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "count", arguments: { n: 4 } } });
      c.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "count", arguments: { n: 4 } } });
      await c.completionOrder(2);

      const notes = c.notifications("notifications/tools/progress");
      expect(notes.length).toBe(8);
      // Each call's chunks are recoverable in order by filtering on the id — which
      // is the whole reason the id had to be added.
      for (const id of [1, 2]) {
        expect(notes.filter(n => n.params.id === id).map(n => n.params.text)).toEqual(["1", "2", "3", "4"]);
      }
      // And they really did interleave, otherwise the correlator wouldn't matter.
      const ids = notes.map(n => n.params.id);
      expect(new Set(ids.slice(0, 2)).size).toBe(2);
    } finally { c.close(); }
  }, 20_000);

  test("notifications precede the final response for their request", async () => {
    const c = connect(FIXTURE);
    try {
      c.send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "count", arguments: { n: 3 } } });
      await c.response(1);

      const lastNote = c.seen.findLastIndex((m: any) => m.method === "notifications/tools/progress" && m.params.id === 1);
      const finalRes = c.seen.findIndex((m: any) => m.id === 1 && m.result !== undefined);
      expect(lastNote).toBeGreaterThan(-1);
      expect(finalRes).toBeGreaterThan(lastNote);
    } finally { c.close(); }
  }, 20_000);
});

describe("the reader never blocks on a full queue", () => {
  test("a sampling reply is read even when requests are queued past the cap", async () => {
    // cap of 1: the sampling tool occupies the only slot, and five more requests
    // pile up behind it. If the reader waited for a slot instead of queueing, the
    // reply below would never be read and this would deadlock.
    const c = connect(FIXTURE, { MAX_IN_FLIGHT: "1", REQUEST_TIMEOUT: "0" });
    let held: any = null;
    c.onSampling((req) => { held = req; return null; });
    try {
      c.send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ask", arguments: { text: "holding the slot" } } });
      await c.pumpUntil(() => (held ? true : undefined));

      for (let id = 2; id <= 6; id++) {
        c.send({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "echo", arguments: { text: `queued ${id}` } } });
      }

      // Answer the held request. Nothing has run it yet except the sampling tool.
      c.send({ jsonrpc: "2.0", id: held.id, result: { content: { type: "text", text: "unblocked" } } });

      expect(payload(await c.response(1)).reply).toBe("unblocked");
      // And the queue drains afterwards.
      const order = await c.completionOrder(6);
      expect(order.sort((a: number, b: number) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    } finally { c.close(); }
  }, 30_000);

  test("maxInFlight 1 serialises handlers without breaking sampling", async () => {
    const c = connect(FIXTURE, { MAX_IN_FLIGHT: "1" });
    try {
      for (let id = 1; id <= 4; id++) {
        c.send({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "slow", arguments: { ms: 40 } } });
      }
      await c.completionOrder(4);
      const peaks = [1, 2, 3, 4].map(id => payload(c.seen.find((m: any) => m.id === id)).peak);
      expect(Math.max(...peaks)).toBe(1);
    } finally { c.close(); }
  }, 30_000);
});
