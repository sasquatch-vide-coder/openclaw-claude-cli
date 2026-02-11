import { execSync } from "node:child_process";
import type { ApplyAuthChoiceParams, ApplyAuthChoiceResult } from "./auth-choice.apply.js";
import { applyDefaultModelChoice } from "./auth-choice.default-model.js";
import { ensureModelAllowlistEntry } from "./model-allowlist.js";

const CLAUDE_CLI_DEFAULT_MODEL = "claude-cli/opus";

export async function applyAuthChoiceClaudeCli(
  params: ApplyAuthChoiceParams,
): Promise<ApplyAuthChoiceResult | null> {
  if (params.authChoice !== "claude-cli") {
    return null;
  }

  let nextConfig = params.config;
  let agentModelOverride: string | undefined;

  // 1. Verify `claude` is on PATH
  let version: string | undefined;
  try {
    version = execSync("claude --version", {
      timeout: 10_000,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // Not found
  }

  if (!version) {
    await params.prompter.note(
      [
        "Claude Code CLI not found on PATH.",
        "Install: https://code.claude.com/docs/en/setup",
        "Then run `claude` once to authenticate.",
      ].join("\n"),
      "CLI not found",
    );
    return { config: params.config };
  }

  await params.prompter.note(
    `Claude Code CLI detected (${version}). No API key required.`,
    "CLI found",
  );

  const noteAgentModel = async (model: string) => {
    if (!params.agentId) {
      return;
    }
    await params.prompter.note(
      `Default model set to ${model} for agent "${params.agentId}".`,
      "Model configured",
    );
  };

  const applied = await applyDefaultModelChoice({
    config: nextConfig,
    setDefaultModel: params.setDefaultModel,
    defaultModel: CLAUDE_CLI_DEFAULT_MODEL,
    applyDefaultConfig: (config) => ({
      ...config,
      agents: {
        ...config.agents,
        defaults: {
          ...config.agents?.defaults,
          model: { ...config.agents?.defaults?.model, primary: CLAUDE_CLI_DEFAULT_MODEL },
        },
      },
    }),
    applyProviderConfig: (config) =>
      ensureModelAllowlistEntry({ cfg: config, modelRef: CLAUDE_CLI_DEFAULT_MODEL }),
    noteDefault: CLAUDE_CLI_DEFAULT_MODEL,
    noteAgentModel,
    prompter: params.prompter,
  });
  nextConfig = applied.config;
  agentModelOverride = applied.agentModelOverride ?? agentModelOverride;

  return { config: nextConfig, agentModelOverride };
}
