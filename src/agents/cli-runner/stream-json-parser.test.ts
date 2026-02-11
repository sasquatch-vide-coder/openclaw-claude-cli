import { describe, expect, it, vi } from "vitest";
import { StreamJsonAccumulator } from "./stream-json-parser.js";

describe("StreamJsonAccumulator", () => {
  it("extracts session_id from system event", () => {
    const acc = new StreamJsonAccumulator();
    acc.handleLine(JSON.stringify({ type: "system", session_id: "sess-123" }));
    const output = acc.finalize();
    expect(output.sessionId).toBe("sess-123");
  });

  it("accumulates assistant text blocks", () => {
    const onAssistantText = vi.fn();
    const acc = new StreamJsonAccumulator({ onAssistantText });

    acc.handleLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Hello " },
            { type: "text", text: "world" },
          ],
        },
      }),
    );

    expect(onAssistantText).toHaveBeenCalledTimes(2);
    expect(onAssistantText).toHaveBeenCalledWith("Hello ");
    expect(onAssistantText).toHaveBeenCalledWith("world");

    const output = acc.finalize();
    expect(output.text).toBe("Hello world");
  });

  it("records tool_use events and resolves names", () => {
    const onToolUse = vi.fn();
    const acc = new StreamJsonAccumulator({ onToolUse });

    acc.handleLine(
      JSON.stringify({
        type: "tool_use",
        tool_use_id: "tu-1",
        name: "Read",
        input: { file_path: "/foo/bar.ts" },
      }),
    );

    expect(onToolUse).toHaveBeenCalledWith({
      name: "Read",
      toolCallId: "tu-1",
      args: { file_path: "/foo/bar.ts" },
    });
    expect(acc.getToolName("tu-1")).toBe("Read");
    expect(acc.getToolName("unknown-id")).toBe("unknown");
  });

  it("dispatches tool_result events with resolved tool name", () => {
    const onToolResult = vi.fn();
    const acc = new StreamJsonAccumulator({ onToolResult });

    // Register tool first
    acc.handleLine(
      JSON.stringify({ type: "tool_use", tool_use_id: "tu-2", name: "Write" }),
    );

    acc.handleLine(
      JSON.stringify({
        type: "tool_result",
        tool_use_id: "tu-2",
        is_error: false,
        content: "File written successfully.",
      }),
    );

    expect(onToolResult).toHaveBeenCalledWith({
      name: "Write",
      toolCallId: "tu-2",
      isError: false,
      result: "File written successfully.",
    });
  });

  it("handles tool_result with output field instead of content", () => {
    const onToolResult = vi.fn();
    const acc = new StreamJsonAccumulator({ onToolResult });

    acc.handleLine(
      JSON.stringify({
        type: "tool_result",
        tool_use_id: "tu-3",
        is_error: true,
        output: "Permission denied",
      }),
    );

    expect(onToolResult).toHaveBeenCalledWith({
      name: "unknown",
      toolCallId: "tu-3",
      isError: true,
      result: "Permission denied",
    });
  });

  it("extracts final result with usage", () => {
    const acc = new StreamJsonAccumulator();
    acc.handleLine(
      JSON.stringify({
        type: "result",
        result: "Final answer.",
        session_id: "sess-456",
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    );

    const output = acc.finalize();
    expect(output.text).toBe("Final answer.");
    expect(output.sessionId).toBe("sess-456");
    expect(output.usage).toEqual({ input_tokens: 100, output_tokens: 50 });
  });

  it("result text overrides accumulated assistant text", () => {
    const acc = new StreamJsonAccumulator();
    acc.handleLine(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "streaming text" }] },
      }),
    );
    acc.handleLine(
      JSON.stringify({ type: "result", result: "Final answer." }),
    );

    const output = acc.finalize();
    expect(output.text).toBe("Final answer.");
  });

  it("gracefully ignores malformed lines", () => {
    const acc = new StreamJsonAccumulator();
    acc.handleLine("not json at all");
    acc.handleLine("{broken json");
    acc.handleLine("");
    acc.handleLine(JSON.stringify({ type: "unknown_event", data: "something" }));

    const output = acc.finalize();
    expect(output.text).toBe("");
    expect(output.sessionId).toBeUndefined();
  });

  it("handles assistant message with non-text content blocks", () => {
    const onAssistantText = vi.fn();
    const acc = new StreamJsonAccumulator({ onAssistantText });

    acc.handleLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "image", source: {} },
            { type: "text", text: "valid text" },
          ],
        },
      }),
    );

    expect(onAssistantText).toHaveBeenCalledTimes(1);
    expect(onAssistantText).toHaveBeenCalledWith("valid text");
  });

  it("handles full streaming session end-to-end", () => {
    const onAssistantText = vi.fn();
    const onToolUse = vi.fn();
    const onToolResult = vi.fn();
    const acc = new StreamJsonAccumulator({ onAssistantText, onToolUse, onToolResult });

    acc.handleLine(JSON.stringify({ type: "system", session_id: "sess-e2e" }));
    acc.handleLine(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Let me read the file." }] },
      }),
    );
    acc.handleLine(
      JSON.stringify({
        type: "tool_use",
        tool_use_id: "tu-e2e",
        name: "Read",
        input: { file_path: "/src/index.ts" },
      }),
    );
    acc.handleLine(
      JSON.stringify({
        type: "tool_result",
        tool_use_id: "tu-e2e",
        is_error: false,
        content: "file contents here",
      }),
    );
    acc.handleLine(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: " Here is the result." }] },
      }),
    );
    acc.handleLine(
      JSON.stringify({
        type: "result",
        result: "Let me read the file. Here is the result.",
        session_id: "sess-e2e",
        usage: { input_tokens: 200, output_tokens: 100 },
      }),
    );

    expect(onAssistantText).toHaveBeenCalledTimes(2);
    expect(onToolUse).toHaveBeenCalledTimes(1);
    expect(onToolResult).toHaveBeenCalledTimes(1);

    const output = acc.finalize();
    expect(output.text).toBe("Let me read the file. Here is the result.");
    expect(output.sessionId).toBe("sess-e2e");
    expect(output.usage).toEqual({ input_tokens: 200, output_tokens: 100 });
  });
});
