import { describe, expect, test } from "bun:test";
import { join } from "path";

const SERVER_PATH = join(import.meta.dir, "..", "examples", "basic.ts");

// Writes a request to the server's stdin as a caller-chosen sequence of byte
// chunks, so a test can split a multi-byte character across a chunk boundary the
// way a 256 KiB stdin read does.
async function echoInChunks(chunks: Uint8Array[], timeout = 5000) {
  const proc = Bun.spawn([process.execPath, "run", SERVER_PATH], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  for (const chunk of chunks) {
    proc.stdin.write(chunk);
    proc.stdin.flush();
    // Force the reader to see this chunk on its own rather than a coalesced pipe
    // read, which is what makes the boundary observable.
    await Bun.sleep(20);
  }

  const decoder = new TextDecoder();
  const reader = proc.stdout.getReader();
  let buf = "";
  const timer = setTimeout(() => reader.cancel(), timeout);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const nl = buf.indexOf("\n");
      if (nl !== -1) return JSON.parse(buf.slice(0, nl));
    }
  } finally {
    clearTimeout(timer);
    proc.stdin.end();
    proc.kill();
  }
  throw new Error("No response received");
}

function requestBytes(message: string) {
  return new TextEncoder().encode(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "echo", arguments: { message } },
    }) + "\n"
  );
}

// Split the encoded request immediately after the first byte of the multi-byte
// sequence starting with `lead`, leaving the continuation bytes for chunk two.
function splitMidSequence(bytes: Uint8Array, lead: number): [Uint8Array, Uint8Array] {
  const at = bytes.indexOf(lead) + 1;
  expect(at).toBeGreaterThan(0);
  return [bytes.subarray(0, at), bytes.subarray(at)];
}

describe("stdio transport character encoding", () => {
  test("survives a 2-byte sequence split across chunks", async () => {
    const message = "Fredrik Pålin — Svensk Travsport";
    const [a, b] = splitMidSequence(requestBytes(message), 0xc3); // "å" is C3 A5

    const res = await echoInChunks([a, b]);
    expect(JSON.parse(res.result.content[0].text).echoed).toBe(message);
  });

  test("survives a 4-byte sequence split across chunks", async () => {
    const message = "hästen 🐎 galopperar";
    const [a, b] = splitMidSequence(requestBytes(message), 0xf0); // "🐎" is F0 9F 90 8E

    const res = await echoInChunks([a, b]);
    expect(JSON.parse(res.result.content[0].text).echoed).toBe(message);
  });

  test("does not emit U+FFFD for a boundary-split character", async () => {
    const bytes = requestBytes("Malmö Åby Solvalla");
    const [a, b] = splitMidSequence(bytes, 0xc3);

    const res = await echoInChunks([a, b]);
    expect(JSON.parse(res.result.content[0].text).echoed).not.toInclude("�");
  });

  test("a request arriving in one chunk is unaffected", async () => {
    const message = "Motala Ströms Travsällskap";
    const res = await echoInChunks([requestBytes(message)]);
    expect(JSON.parse(res.result.content[0].text).echoed).toBe(message);
  });

  test("a trailing partial sequence produces no response and no crash", async () => {
    // Half a character with no newline: the server must hold it, not decode it,
    // and must stay alive for the completing chunk.
    const bytes = requestBytes("Åmål");
    const [a, b] = splitMidSequence(bytes, 0xc3);

    const proc = Bun.spawn([process.execPath, "run", SERVER_PATH], {
      stdin: "pipe", stdout: "pipe", stderr: "pipe",
    });
    proc.stdin.write(a);
    proc.stdin.flush();
    await Bun.sleep(150);
    expect(proc.exitCode).toBeNull(); // still running, nothing emitted

    proc.stdin.write(b);
    proc.stdin.flush();

    const reader = proc.stdout.getReader();
    const { value } = await reader.read();
    const line = new TextDecoder().decode(value).split("\n")[0]!;
    expect(JSON.parse(JSON.parse(line).result.content[0].text).echoed).toBe("Åmål");

    proc.stdin.end();
    proc.kill();
  });
});
