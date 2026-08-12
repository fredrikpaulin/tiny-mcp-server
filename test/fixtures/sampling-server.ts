// Fixture for the concurrency and sampling tests. Tools cover the shapes that
// matter once handlers can overlap: one that talks back to the client, one that
// takes time, one that streams, one that throws, and one that does nothing much.
import { registerTool, sample, serve } from "../../src/mcp";

registerTool(
  "ask",
  "Sends a sampling request to the client and returns its reply",
  { type: "object", required: ["text"], properties: { text: { type: "string" } } },
  async ({ text }) => {
    const reply = await sample({
      messages: [{ role: "user", content: { type: "text", text: text as string } }],
      maxTokens: 32,
    });
    return { reply };
  }
);

registerTool(
  "echo",
  "Returns its input without talking to the client",
  { type: "object", required: ["text"], properties: { text: { type: "string" } } },
  async ({ text }) => ({ echoed: text })
);

// Tracks how many handlers are running at once, so a test can assert the
// in-flight cap actually bounds concurrency.
let running = 0;
let peak = 0;

registerTool(
  "slow",
  "Sleeps, then reports the peak observed concurrency",
  { type: "object", required: ["ms"], properties: { ms: { type: "integer" } } },
  async ({ ms }) => {
    running++;
    if (running > peak) peak = running;
    try {
      await Bun.sleep(ms as number);
      return { slept: ms, peak };
    } finally { running--; }
  }
);

registerTool(
  "count",
  "Streams the numbers 1..n",
  { type: "object", required: ["n"], properties: { n: { type: "integer" } } },
  async function* ({ n }) {
    for (let i = 1; i <= (n as number); i++) {
      yield `${i}`;
      await Bun.sleep(15);
    }
  }
);

serve({
  name: "sampling-fixture",
  version: "0.0.1",
  requestTimeout: Number(Bun.env.REQUEST_TIMEOUT ?? 300),
  maxInFlight: Number(Bun.env.MAX_IN_FLIGHT ?? 16),
});
