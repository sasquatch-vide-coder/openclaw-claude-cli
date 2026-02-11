import { spawn } from "node:child_process";
import type { SpawnResult, CommandOptions } from "./exec.js";
import { resolveCommand } from "./exec.js";
import { resolveCommandStdio } from "./spawn-utils.js";

export type StreamingCommandOptions = CommandOptions & {
  onStdoutLine: (line: string) => void;
};

/**
 * Spawns a process and streams stdout line-by-line via `onStdoutLine`.
 * Accumulates stderr as a string. Returns the same `SpawnResult` shape
 * as `runCommandWithTimeout`.
 */
export async function runCommandStreaming(
  argv: string[],
  options: StreamingCommandOptions,
): Promise<SpawnResult> {
  const { timeoutMs, cwd, input, env, onStdoutLine } = options;
  const { windowsVerbatimArguments } = options;
  const hasInput = input !== undefined;

  const resolvedEnv = env ? { ...process.env, ...env } : { ...process.env };

  const stdio = resolveCommandStdio({ hasInput, preferInherit: false });
  const child = spawn(resolveCommand(argv[0]), argv.slice(1), {
    stdio,
    cwd,
    env: resolvedEnv,
    windowsVerbatimArguments,
  });

  return await new Promise((resolve, reject) => {
    let stderr = "";
    let lineBuffer = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (typeof child.kill === "function") {
        child.kill("SIGKILL");
      }
    }, timeoutMs);

    if (hasInput && child.stdin) {
      child.stdin.write(input ?? "");
      child.stdin.end();
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      lineBuffer += chunk.toString();
      let newlineIdx: number;
      while ((newlineIdx = lineBuffer.indexOf("\n")) !== -1) {
        const line = lineBuffer.slice(0, newlineIdx);
        lineBuffer = lineBuffer.slice(newlineIdx + 1);
        if (line.length > 0) {
          onStdoutLine(line);
        }
      }
    });

    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    child.on("error", (err) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      // Flush any remaining partial line
      if (lineBuffer.length > 0) {
        onStdoutLine(lineBuffer);
        lineBuffer = "";
      }
      resolve({ stdout: "", stderr, code, signal, killed: child.killed });
    });
  });
}
