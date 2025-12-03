import { registerTool, registerResource, serve } from "./mcp";

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

serve();
