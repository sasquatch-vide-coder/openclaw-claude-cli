import { describe, expect, it, vi } from "vitest";
import { runCommandStreaming } from "./exec-streaming.js";

describe("runCommandStreaming", () => {
  it("streams stdout lines via callback", async () => {
    const lines: string[] = [];
    // Use node to echo multi-line output
    const script = 'console.log("line1"); console.log("line2"); console.log("line3");';
    const result = await runCommandStreaming(["node", "-e", script], {
      timeoutMs: 10_000,
      onStdoutLine: (line) => lines.push(line),
    });

    expect(result.code).toBe(0);
    expect(result.killed).toBe(false);
    expect(lines).toEqual(["line1", "line2", "line3"]);
  });

  it("handles partial chunks that split across lines", async () => {
    const lines: string[] = [];
    // Write partial lines using process.stdout.write
    const script = [
      'process.stdout.write("hel");',
      'process.stdout.write("lo\\nwor");',
      'process.stdout.write("ld\\n");',
    ].join("");

    const result = await runCommandStreaming(["node", "-e", script], {
      timeoutMs: 10_000,
      onStdoutLine: (line) => lines.push(line),
    });

    expect(result.code).toBe(0);
    expect(lines).toEqual(["hello", "world"]);
  });

  it("flushes remaining partial line on close", async () => {
    const lines: string[] = [];
    // Write a line without trailing newline
    const script = 'process.stdout.write("no-newline");';

    const result = await runCommandStreaming(["node", "-e", script], {
      timeoutMs: 10_000,
      onStdoutLine: (line) => lines.push(line),
    });

    expect(result.code).toBe(0);
    expect(lines).toEqual(["no-newline"]);
  });

  it("accumulates stderr", async () => {
    const lines: string[] = [];
    const script = 'console.error("err1"); console.error("err2"); console.log("out");';

    const result = await runCommandStreaming(["node", "-e", script], {
      timeoutMs: 10_000,
      onStdoutLine: (line) => lines.push(line),
    });

    expect(result.code).toBe(0);
    expect(lines).toEqual(["out"]);
    expect(result.stderr).toContain("err1");
    expect(result.stderr).toContain("err2");
  });

  it("reports non-zero exit codes", async () => {
    const lines: string[] = [];
    const script = 'console.log("before"); process.exit(42);';

    const result = await runCommandStreaming(["node", "-e", script], {
      timeoutMs: 10_000,
      onStdoutLine: (line) => lines.push(line),
    });

    expect(result.code).toBe(42);
    expect(lines).toContain("before");
  });

  it("kills process on timeout", async () => {
    const lines: string[] = [];
    // Sleep for a long time
    const script = 'setTimeout(() => {}, 60000); console.log("started");';

    const result = await runCommandStreaming(["node", "-e", script], {
      timeoutMs: 500,
      onStdoutLine: (line) => lines.push(line),
    });

    expect(result.killed).toBe(true);
    expect(lines).toContain("started");
  }, 10_000);

  it("passes stdin input to process", async () => {
    const lines: string[] = [];
    const script = `
      let data = "";
      process.stdin.on("data", (chunk) => { data += chunk; });
      process.stdin.on("end", () => { console.log("GOT:" + data.trim()); });
    `;

    const result = await runCommandStreaming(["node", "-e", script], {
      timeoutMs: 10_000,
      input: "hello stdin",
      onStdoutLine: (line) => lines.push(line),
    });

    expect(result.code).toBe(0);
    expect(lines).toEqual(["GOT:hello stdin"]);
  });

  it("returns empty stdout string (lines are streamed via callback)", async () => {
    const lines: string[] = [];
    const script = 'console.log("data");';

    const result = await runCommandStreaming(["node", "-e", script], {
      timeoutMs: 10_000,
      onStdoutLine: (line) => lines.push(line),
    });

    // stdout is empty because it was streamed via callback
    expect(result.stdout).toBe("");
    expect(lines).toEqual(["data"]);
  });
});
