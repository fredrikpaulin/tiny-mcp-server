# Streaming Tool Responses

tiny-mcp-server supports streaming tool responses using async generators. Each yielded chunk is sent as a JSON-RPC notification to the client immediately, and the final response contains the full concatenated text.

## How It Works

When a tool handler is an async generator (uses `function*`), the server:

1. Iterates the generator
2. Sends each yielded string as a `notifications/tools/progress` notification
3. Collects all chunks
4. Sends the final `tools/call` response with the concatenated text

Clients that understand the notifications get live streaming updates. Clients that ignore notifications still receive the complete result in the final response — so this is fully backward compatible.

## Basic Usage

```ts
import { registerTool, serve } from "tiny-mcp-server";

registerTool(
  "writer",
  "Write a story based on a prompt",
  {
    type: "object",
    required: ["prompt"],
    properties: { prompt: { type: "string" } }
  },
  async function* ({ prompt }) {
    for await (const chunk of generateStory(prompt)) {
      yield chunk;  // sent to client immediately as a notification
    }
    // Final response contains all chunks concatenated
  }
);

serve({ name: "my-server", version: "1.0.0" });
```

No opt-in flag is needed — using `async function*` instead of `async function` is the opt-in. Regular async handlers work exactly as before.

## Notification Format

Each yielded chunk is sent as a JSON-RPC notification (no `id` field):

```json
{ "jsonrpc": "2.0", "method": "notifications/tools/progress", "params": { "text": "Once upon a " } }
{ "jsonrpc": "2.0", "method": "notifications/tools/progress", "params": { "text": "time, there was " } }
{ "jsonrpc": "2.0", "method": "notifications/tools/progress", "params": { "text": "a tiny server." } }
```

After the generator completes, the normal `tools/call` response is sent:

```json
{ "jsonrpc": "2.0", "id": 1, "result": { "content": [{ "type": "text", "text": "Once upon a time, there was a tiny server." }] } }
```

## Streaming with Sampling

This pairs well with `sample()` for AI-proxying tools. While `sample()` itself doesn't stream, you can break work into steps and yield progress:

```ts
registerTool("analyze", "Multi-step analysis", schema, async function* ({ text }) {
  yield "Summarizing...\n";
  const summary = await sample({
    messages: [{ role: "user", content: { type: "text", text: `Summarize:\n\n${text}` } }],
    maxTokens: 200
  });
  yield summary + "\n\nCritiquing...\n";

  const critique = await sample({
    messages: [{ role: "user", content: { type: "text", text: `Critique:\n\n${summary}` } }],
    maxTokens: 300
  });
  yield critique;
});
```

## Error Handling

If a generator throws (including `ToolError`), the error is caught and returned as a normal error response. Any chunks yielded before the error are sent as notifications but the final response is an error:

```ts
registerTool("risky", "Might fail", schema, async function* () {
  yield "Starting...\n";
  yield "Processing...\n";
  throw new ToolError("external_error", "API call failed");
  // Client receives 2 notifications, then an error response
});
```

## Validation

Input validation runs before the generator starts. If validation fails, the generator body never executes:

```ts
registerTool("strict", "Validated streaming", {
  type: "object",
  required: ["text"],
  properties: { text: { type: "string" } }
}, async function* ({ text }) {
  // This only runs if 'text' is a valid string
  yield `Processing: ${text}`;
});
```

## Client Implementation

Clients should read all messages for a `tools/call` request until they receive one with a matching `id`. Messages without an `id` are notifications:

```ts
// Pseudo-code for a client consuming streaming responses
const messages = [];
while (true) {
  const msg = await readJsonLine();
  if (msg.id === requestId) {
    // Final response — done
    return { notifications: messages, response: msg };
  }
  // Notification — display to user
  messages.push(msg);
  displayChunk(msg.params.text);
}
```

## Testing Streaming Handlers

Unit tests can capture notifications via the `write` callback:

```ts
import { handleRequest, registerTool, _reset } from "tiny-mcp-server";

test("streaming sends notifications", async () => {
  registerTool("stream", "Stream", {}, async function* () {
    yield "a";
    yield "b";
  });

  const notifications: any[] = [];
  const res = await handleRequest(
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "stream", arguments: {} } },
    (msg) => notifications.push(msg)
  );

  expect(notifications).toHaveLength(2);
  expect(notifications[0].params.text).toBe("a");
  expect(res.result.content[0].text).toBe("ab");
});
```

Without a `write` callback, notifications are silently skipped but the final response still contains the full concatenated text.
