import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  RETRY_REMINDER,
  type GenerateJsonInput,
  type GenerateJsonResult,
  type ModelClient,
} from "../model-client.js";
import { assertAiModeEnabled } from "../../lib/ai-mode.js";

const TOOL_NAME = "emit_result";

/** Builds a forced tool-use schema from the caller's zod schema, so the
 * model is constrained to the exact shape instead of us regex-extracting
 * JSON out of free text (which is where silent shape drift creeps in). */
function buildTool<T>(schema: z.ZodType<T>): Anthropic.Tool {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return {
    name: TOOL_NAME,
    description: "Emit the structured result matching the required schema.",
    input_schema: jsonSchema as Anthropic.Tool.InputSchema,
  };
}

// Model id confirmed against the claude-api skill/reference at
// implementation time rather than hardcoded from memory — ids change.
const MODEL = "claude-haiku-4-5";

// Source: https://platform.claude.com/docs/en/about-claude/pricing
// (model pricing table), checked 2026-11-08. Re-check before trusting
// this for a go/no-go decision — Anthropic's published prices change.
const PRICING_USD_PER_MTOK = { input: 1.0, output: 5.0 };

function estimateCostUsd(tokensIn: number, tokensOut: number): number {
  return (
    (tokensIn / 1_000_000) * PRICING_USD_PER_MTOK.input +
    (tokensOut / 1_000_000) * PRICING_USD_PER_MTOK.output
  );
}

export class ClaudeModelClient implements ModelClient {
  readonly providerId = "claude" as const;
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    // See docs/decisions/007-free-mode.md — AI_MODE must be "on" for this
    // to construct a working client at all.
    assertAiModeEnabled("ClaudeModelClient constructor");
    this.client = new Anthropic({ apiKey });
  }

  async generateJSON<T>(input: GenerateJsonInput<T>): Promise<GenerateJsonResult<T>> {
    const start = performance.now();
    const tool = buildTool(input.schema);
    let tokensIn = 0;
    let tokensOut = 0;
    let rateLimited = false;
    let rawText: string | null = null;
    let finishReason: string | null = null;
    let gotToolUse = false;

    const callOnce = async (userPrompt: string): Promise<unknown | null> => {
      try {
        const message = await this.client.messages.create({
          model: MODEL,
          max_tokens: input.maxTokens ?? 2048,
          system: input.systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
          tools: [tool],
          tool_choice: { type: "tool", name: TOOL_NAME },
        });
        tokensIn += message.usage.input_tokens;
        tokensOut += message.usage.output_tokens;
        finishReason = message.stop_reason;
        const toolUseBlock = message.content.find((b) => b.type === "tool_use");
        gotToolUse = Boolean(toolUseBlock);
        rawText = toolUseBlock ? JSON.stringify(toolUseBlock.input) : null;
        return toolUseBlock ? toolUseBlock.input : null;
      } catch (err) {
        if (err instanceof Anthropic.RateLimitError) {
          rateLimited = true;
          return null;
        }
        throw err;
      }
    };

    let parsed = await callOnce(input.userPrompt);
    let data = parsed ? safeParse(input.schema, parsed) : null;
    if (!data && !rateLimited) {
      console.error(
        `[claude] structured output did not match schema on first attempt, raw tool input: ${rawText ?? "(no tool_use block)"}`,
      );
      parsed = await callOnce(`${input.userPrompt}\n\n${RETRY_REMINDER}`);
      data = parsed ? safeParse(input.schema, parsed) : null;
      if (!data) {
        console.error(
          `[claude] structured output still did not match schema after retry, raw tool input: ${rawText ?? "(no tool_use block)"}`,
        );
      }
    }

    const truncated = finishReason === "max_tokens";
    const empty = !rateLimited && !gotToolUse;

    return {
      data,
      tokensIn,
      tokensOut,
      costUsd: estimateCostUsd(tokensIn, tokensOut),
      latencyMs: performance.now() - start,
      rateLimited,
      rawText,
      finishReason,
      truncated,
      empty,
    };
  }
}

function safeParse<T>(schema: z.ZodType<T>, value: unknown): T | null {
  const result = schema.safeParse(value);
  return result.success ? result.data : null;
}
