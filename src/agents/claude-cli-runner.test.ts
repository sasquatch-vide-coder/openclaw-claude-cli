import { beforeEach, describe, expect, it, vi } from "vitest";
import { sleep } from "../utils.js";
import { runClaudeCliAgent } from "./claude-cli-runner.js";

const runCommandStreamingMock = vi.fn();

function createDeferred<T>() {
  let resolve: (value: T) => void;
  let reject: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {
    promise,
    resolve: resolve as (value: T) => void,
    reject: reject as (error: unknown) => void,
  };
}

async function waitForCalls(mockFn: { mock: { calls: unknown[][] } }, count: number) {
  for (let i = 0; i < 50; i += 1) {
    if (mockFn.mock.calls.length >= count) {
      return;
    }
    await sleep(0);
  }
  throw new Error(`Expected ${count} calls, got ${mockFn.mock.calls.length}`);
}

vi.mock("../process/exec.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../process/exec.js")>();
  return {
    ...actual,
    runCommandWithTimeout: vi.fn(),
    runExec: vi.fn(),
  };
});

vi.mock("../process/exec-streaming.js", () => ({
  runCommandStreaming: (...args: unknown[]) => runCommandStreamingMock(...args),
}));

vi.mock("../infra/agent-events.js", () => ({
  emitAgentEvent: vi.fn(),
  registerAgentRunContext: vi.fn(),
  getAgentRunContext: vi.fn(),
  clearAgentRunContext: vi.fn(),
}));

/** Helper: create a streaming mock that feeds stream-json lines via onStdoutLine */
function makeStreamingResult(lines: string[]) {
  return async (_argv: string[], opts: { onStdoutLine: (line: string) => void }) => {
    for (const line of lines) {
      opts.onStdoutLine(line);
    }
    return { stdout: "", stderr: "", code: 0, signal: null, killed: false };
  };
}

describe("runClaudeCliAgent", () => {
  beforeEach(() => {
    runCommandStreamingMock.mockReset();
  });

  it("starts a new session with --session-id when none is provided", async () => {
    runCommandStreamingMock.mockImplementationOnce(
      makeStreamingResult([
        JSON.stringify({ type: "result", result: "ok", session_id: "sid-1" }),
      ]),
    );

    await runClaudeCliAgent({
      sessionId: "openclaw-session",
      sessionFile: "/tmp/session.jsonl",
      workspaceDir: "/tmp",
      prompt: "hi",
      model: "opus",
      timeoutMs: 1_000,
      runId: "run-1",
    });

    expect(runCommandStreamingMock).toHaveBeenCalledTimes(1);
    const argv = runCommandStreamingMock.mock.calls[0]?.[0] as string[];
    expect(argv).toContain("claude");
    expect(argv).toContain("--session-id");
    expect(argv).toContain("hi");
  });

  it("uses --resume when a claude session id is provided", async () => {
    runCommandStreamingMock.mockImplementationOnce(
      makeStreamingResult([
        JSON.stringify({ type: "result", result: "ok", session_id: "sid-2" }),
      ]),
    );

    await runClaudeCliAgent({
      sessionId: "openclaw-session",
      sessionFile: "/tmp/session.jsonl",
      workspaceDir: "/tmp",
      prompt: "hi",
      model: "opus",
      timeoutMs: 1_000,
      runId: "run-2",
      claudeSessionId: "c9d7b831-1c31-4d22-80b9-1e50ca207d4b",
    });

    expect(runCommandStreamingMock).toHaveBeenCalledTimes(1);
    const argv = runCommandStreamingMock.mock.calls[0]?.[0] as string[];
    expect(argv).toContain("--resume");
    expect(argv).toContain("c9d7b831-1c31-4d22-80b9-1e50ca207d4b");
    expect(argv).toContain("hi");
  });

  it("serializes concurrent claude-cli runs", async () => {
    const firstDeferred = createDeferred<{
      stdout: string;
      stderr: string;
      code: number | null;
      signal: NodeJS.Signals | null;
      killed: boolean;
    }>();
    const secondDeferred = createDeferred<{
      stdout: string;
      stderr: string;
      code: number | null;
      signal: NodeJS.Signals | null;
      killed: boolean;
    }>();

    runCommandStreamingMock
      .mockImplementationOnce(
        async (_argv: string[], opts: { onStdoutLine: (line: string) => void }) => {
          const result = await firstDeferred.promise;
          opts.onStdoutLine(
            JSON.stringify({ type: "result", result: "ok", session_id: "sid-1" }),
          );
          return result;
        },
      )
      .mockImplementationOnce(
        async (_argv: string[], opts: { onStdoutLine: (line: string) => void }) => {
          const result = await secondDeferred.promise;
          opts.onStdoutLine(
            JSON.stringify({ type: "result", result: "ok", session_id: "sid-2" }),
          );
          return result;
        },
      );

    const firstRun = runClaudeCliAgent({
      sessionId: "s1",
      sessionFile: "/tmp/session.jsonl",
      workspaceDir: "/tmp",
      prompt: "first",
      model: "opus",
      timeoutMs: 1_000,
      runId: "run-1",
    });

    const secondRun = runClaudeCliAgent({
      sessionId: "s2",
      sessionFile: "/tmp/session.jsonl",
      workspaceDir: "/tmp",
      prompt: "second",
      model: "opus",
      timeoutMs: 1_000,
      runId: "run-2",
    });

    await waitForCalls(runCommandStreamingMock, 1);

    firstDeferred.resolve({
      stdout: "",
      stderr: "",
      code: 0,
      signal: null,
      killed: false,
    });

    await waitForCalls(runCommandStreamingMock, 2);

    secondDeferred.resolve({
      stdout: "",
      stderr: "",
      code: 0,
      signal: null,
      killed: false,
    });

    await Promise.all([firstRun, secondRun]);
  });
});
