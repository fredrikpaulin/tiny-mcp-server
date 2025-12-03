import { registerTool, registerResource, registerResourceTemplate, sample, serve } from "./mcp";

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
  async ({ name }) => process.env[name] || ""
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

serve({ name: "tiny-mcp-server", version: "0.0.1" });
