export type CliOutput = {
  text: string;
  sessionId?: string;
  usage?: { input?: number; output?: number };
};

export type StreamJsonCallbacks = {
  onAssistantText?: (text: string) => void;
  onToolUse?: (params: { name: string; toolCallId: string; args: unknown }) => void;
  onToolResult?: (params: {
    name: string;
    toolCallId: string;
    isError: boolean;
    result: string;
  }) => void;
};

/**
 * Accumulates Claude CLI `stream-json` output lines and dispatches events.
 *
 * Each line is a JSON object with a `type` field:
 * - `"system"` — session metadata
 * - `"assistant"` — assistant message content blocks
 * - `"tool_use"` — tool invocation start
 * - `"tool_result"` — tool invocation result
 * - `"result"` — final result with aggregated text + usage
 */
export class StreamJsonAccumulator {
  private sessionId: string | undefined;
  private resultText = "";
  private usage: { input?: number; output?: number } | undefined;
  private toolNameById = new Map<string, string>();
  private callbacks: StreamJsonCallbacks;

  constructor(callbacks: StreamJsonCallbacks = {}) {
    this.callbacks = callbacks;
  }

  handleLine(line: string): void {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      // Gracefully ignore malformed / non-JSON lines
      return;
    }

    const type = parsed.type;

    if (type === "system") {
      this.sessionId = typeof parsed.session_id === "string" ? parsed.session_id : this.sessionId;
      return;
    }

    if (type === "assistant") {
      const message = parsed.message as Record<string, unknown> | undefined;
      const content = Array.isArray(message?.content) ? message.content : [];
      for (const block of content) {
        if (block && typeof block === "object" && (block as Record<string, unknown>).type === "text") {
          const text = (block as Record<string, unknown>).text;
          if (typeof text === "string" && text.length > 0) {
            this.resultText += text;
            this.callbacks.onAssistantText?.(text);
          }
        }
      }
      return;
    }

    if (type === "tool_use") {
      const toolCallId = typeof parsed.tool_use_id === "string" ? parsed.tool_use_id : "";
      const name = typeof parsed.name === "string" ? parsed.name : "unknown";
      const args = parsed.input ?? parsed.args ?? {};
      if (toolCallId) {
        this.toolNameById.set(toolCallId, name);
      }
      this.callbacks.onToolUse?.({ name, toolCallId, args });
      return;
    }

    if (type === "tool_result") {
      const toolCallId = typeof parsed.tool_use_id === "string" ? parsed.tool_use_id : "";
      const name = this.getToolName(toolCallId);
      const isError = parsed.is_error === true;
      const result = typeof parsed.content === "string"
        ? parsed.content
        : typeof parsed.output === "string"
          ? parsed.output
          : JSON.stringify(parsed.content ?? parsed.output ?? "");
      this.callbacks.onToolResult?.({ name, toolCallId, isError, result });
      return;
    }

    if (type === "result") {
      if (typeof parsed.result === "string" && parsed.result.length > 0) {
        this.resultText = parsed.result;
      }
      if (typeof parsed.session_id === "string") {
        this.sessionId = parsed.session_id;
      }
      if (parsed.usage && typeof parsed.usage === "object") {
        const raw = parsed.usage as Record<string, unknown>;
        this.usage = {
          input: (raw.input_tokens ?? raw.input) as number | undefined,
          output: (raw.output_tokens ?? raw.output) as number | undefined,
        };
      }
      return;
    }
  }

  getToolName(toolUseId: string): string {
    return this.toolNameById.get(toolUseId) ?? "unknown";
  }

  finalize(): CliOutput {
    return {
      text: this.resultText,
      sessionId: this.sessionId,
      usage: this.usage,
    };
  }
}
