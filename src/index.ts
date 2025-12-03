import { registerTool, serve } from "./mcp";

// Example tool: echo
registerTool(
  "echo",
  {
    type: "object",
    properties: {
      message: { type: "string", description: "Message to echo back" }
    },
    required: ["message"]
  },
  async ({ message }) => ({ echoed: message })
);

serve();
