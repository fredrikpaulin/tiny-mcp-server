import { registerTool, registerResource, registerResourceTemplate, sample, serve } from "../src/mcp";

// Example tool: echo
registerTool(
  "echo",
  "Echoes back the provided message",
  {
    type: "object",
    properties: {
      message: { type: "string", description: "Message to echo back" }
    },
    required: ["message"]
  },
  async ({ message }) => ({ echoed: message })
);

// Example resource: server info
registerResource(
  "info://server",
  "Server Info",
  "Basic server information",
  "application/json",
  async () => JSON.stringify({ name: "tiny-mcp-server", version: "0.0.1" })
);

// Example resource template: environment variable
registerResourceTemplate(
  "env://{name}",
  "Environment Variable",
  "Read an environment variable",
  "text/plain",
  async ({ name }) => process.env[name!] || ""
);

// Example tool using sampling: summarize
registerTool(
  "summarize",
  "Summarize text using the client's LLM",
  {
    type: "object",
    properties: {
      text: { type: "string", description: "Text to summarize" }
    },
    required: ["text"]
  },
  async ({ text }) => {
    const summary = await sample({
      messages: [{ role: "user", content: { type: "text", text: `Summarize this in one sentence:\n\n${text}` } }],
      maxTokens: 200
    });
    return { summary };
  }
);

// Example streaming tool: count
registerTool(
  "count",
  "Count from 1 to n, streaming each number",
  {
    type: "object",
    properties: {
      n: { type: "integer", minimum: 1, maximum: 10, description: "Number to count to" }
    },
    required: ["n"]
  },
  async function* ({ n }) {
    for (let i = 1; i <= (n as number); i++) {
      yield `${i}`;
      if (i < (n as number)) yield ",";
    }
  }
);

serve({ name: "tiny-mcp-server", version: "0.0.1" });
