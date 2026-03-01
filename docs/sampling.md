# Sampling

Sampling lets your MCP server request LLM completions from the connected client. This is useful for tools that need AI capabilities without requiring their own API keys or model access.

## How It Works

When you call `sample()`, the server sends a `sampling/createMessage` JSON-RPC request to the client over stdio. The client processes it with its own LLM and sends back the response. This means:

- Your server doesn't need API keys for any LLM provider
- The client controls which model is used and what it costs
- The client can apply its own safety filters and rate limits
- Sampling only works while `serve()` is running (the stdio transport must be active)

## Basic Usage

```ts
import { registerTool, sample, serve } from "tiny-mcp-server";

registerTool(
  "summarize",
  "Summarize text using the client's LLM",
  {
    type: "object",
    properties: { text: { type: "string", description: "Text to summarize" } },
    required: ["text"]
  },
  async ({ text }) => {
    const summary = await sample({
      messages: [{ role: "user", content: { type: "text", text: `Summarize in one sentence:\n\n${text}` } }],
      maxTokens: 200
    });
    return { summary };
  }
);

serve({ name: "my-server", version: "1.0.0" });
```

## Options

```ts
const response = await sample({
  messages: [
    { role: "user", content: { type: "text", text: "Hello!" } }
  ],
  maxTokens: 500,
  temperature: 0.7,
  systemPrompt: "You are a helpful assistant."
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `messages` | `SampleMessage[]` | required | Conversation history |
| `maxTokens` | `number` | `1000` | Maximum tokens to generate |
| `temperature` | `number` | omitted | Sampling temperature (only sent if provided) |
| `systemPrompt` | `string` | omitted | System prompt (only sent if provided) |

Each message has the shape `{ role: "user" | "assistant", content: { type: "text", text: string } }`.

`sample()` returns a `Promise<string>` containing the assistant's response text.

## Patterns

### Multi-turn conversation

```ts
const response = await sample({
  messages: [
    { role: "user", content: { type: "text", text: "What is the capital of France?" } },
    { role: "assistant", content: { type: "text", text: "Paris." } },
    { role: "user", content: { type: "text", text: "What is its population?" } }
  ],
  maxTokens: 100
});
```

### Chained sampling

Tools can call `sample()` multiple times:

```ts
registerTool("analyze", "Deep analysis", schema, async ({ text }) => {
  const summary = await sample({
    messages: [{ role: "user", content: { type: "text", text: `Summarize:\n\n${text}` } }],
    maxTokens: 200,
    systemPrompt: "Be concise."
  });

  const critique = await sample({
    messages: [{ role: "user", content: { type: "text", text: `Critique this summary:\n\n${summary}` } }],
    maxTokens: 300,
    systemPrompt: "Be thorough."
  });

  return { summary, critique };
});
```

### Error handling

If the client rejects the sampling request, `sample()` throws. Wrap it to provide a better error:

```ts
import { ToolError, sample } from "tiny-mcp-server";

async function safeSample(options) {
  try {
    return await sample(options);
  } catch (e) {
    throw new ToolError("sampling_failed", `LLM request failed: ${e}`);
  }
}
```

## Client Support

Sampling requires client support. The server advertises `sampling` in its capabilities during initialization. If the client doesn't support sampling, calls to `sample()` will hang (the request is sent but no response comes back). There's no timeout built in — if your tool needs one, wrap the `sample()` call with a `Promise.race` against a timer.

```ts
const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);

const result = await withTimeout(sample({ ... }), 30000);
```
