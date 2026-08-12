// Fixture for the outgoing-request timeout tests. Serves one tool that samples
// and one that doesn't, with a short requestTimeout so a client that never
// answers is observable.
//
// Note: a tool that calls sample() cannot currently complete over stdio even
// when the client does answer — serve() awaits handleRequest inside the stdin
// read loop, so the reply is never read. See ticket #013. requestTimeout turns
// that hang into a clean error, which is what these tests cover.
import { registerTool, sample, serve } from "../../src/mcp";

registerTool(
  "ask",
  "Sends a sampling request to the client and returns its reply",
  {
    type: "object",
    required: ["text"],
    properties: { text: { type: "string" } },
  },
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
  {
    type: "object",
    required: ["text"],
    properties: { text: { type: "string" } },
  },
  async ({ text }) => ({ echoed: text })
);

serve({
  name: "sampling-fixture",
  version: "0.0.1",
  requestTimeout: Number(Bun.env.REQUEST_TIMEOUT ?? 300),
});
