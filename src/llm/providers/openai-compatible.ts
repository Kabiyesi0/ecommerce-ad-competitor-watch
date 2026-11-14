import type { z } from "zod";
import {
  extractFirstJsonObject,
  RETRY_REMINDER,
  type GenerateJsonInput,
  type GenerateJsonResult,
} from "../model-client.js";

export interface OpenAiCompatibleConfig {
  baseUrl: string; // e.g. "https://api.z.ai/api/paas/v4" (no trailing slash)
  apiKey: string;
  model: string;
  pricingUsdPerMtok: { input: number; output: number };
  /** Default output-token budget if the caller doesn't pass one. */
  defaultMaxTokens?: number;
  /** Extra fields merged into the request body, e.g. GLM's `thinking` toggle. */
  extraBody?: Record<string, unknown>;
}

interface OpenAiChatCompletionResponse {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

const FALLBACK_DEFAULT_MAX_TOKENS = 2048;

/**
 * Shared implementation for any provider that exposes an OpenAI-shaped
 * `/chat/completions` endpoint with bearer auth (Z.ai's GLM and Cerebras's
 * Llama both do). Keeps the JSON-extraction/retry-once/cost/rate-limit
 * logic in one place instead of duplicating it per provider.
 */
export async function generateJsonViaOpenAiCompatible<T>(
  config: OpenAiCompatibleConfig,
  input: GenerateJsonInput<T>,
): Promise<GenerateJsonResult<T>> {
  const start = performance.now();
  let tokensIn = 0;
  let tokensOut = 0;
  let rateLimited = false;
  let rawText: string | null = null;
  let finishReason: string | null = null;

  // Empirically (Z.ai, 2026-11-07): a 429 with error code 1305 ("service
  // may be temporarily overloaded") cleared on the 3rd attempt a few
  // seconds apart, with no account/key issue involved — so a 429 here
  // gets a couple of short-backoff retries before being reported as
  // rate-limited, rather than giving up on the first one.
  const MAX_429_RETRIES = 2;
  const RETRY_DELAY_MS = 3000;

  const callOnce = async (userPrompt: string): Promise<unknown | null> => {
    for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: input.systemPrompt },
            { role: "user", content: userPrompt },
          ],
          max_tokens: input.maxTokens ?? config.defaultMaxTokens ?? FALLBACK_DEFAULT_MAX_TOKENS,
          ...config.extraBody,
        }),
      });

      if (response.status === 429) {
        rateLimited = true;
        if (attempt < MAX_429_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
          continue;
        }
        return null;
      }
      // Note: rateLimited is left true if an earlier attempt hit a 429
      // even though this attempt succeeded — GenerateJsonResult.rateLimited
      // means "any underlying call got a 429," not "the call ultimately
      // failed," so a transient 429 that a retry cleared still counts.
      if (!response.ok) {
        throw new Error(`${config.baseUrl} returned HTTP ${response.status}`);
      }

      const body = (await response.json()) as OpenAiChatCompletionResponse;
      tokensIn += body.usage?.prompt_tokens ?? 0;
      tokensOut += body.usage?.completion_tokens ?? 0;
      finishReason = body.choices?.[0]?.finish_reason ?? null;
      rawText = body.choices?.[0]?.message?.content ?? null;
      return rawText ? extractFirstJsonObject(rawText) : null;
    }
    return null;
  };

  let parsed = await callOnce(input.userPrompt);
  let data = parsed ? safeParse(input.schema, parsed) : null;
  if (!data && !rateLimited) {
    parsed = await callOnce(`${input.userPrompt}\n\n${RETRY_REMINDER}`);
    data = parsed ? safeParse(input.schema, parsed) : null;
  }

  const truncated = finishReason === "length";
  const empty = !rateLimited && isBlank(rawText);

  return {
    data,
    tokensIn,
    tokensOut,
    costUsd:
      (tokensIn / 1_000_000) * config.pricingUsdPerMtok.input +
      (tokensOut / 1_000_000) * config.pricingUsdPerMtok.output,
    latencyMs: performance.now() - start,
    rateLimited,
    rawText,
    finishReason,
    truncated,
    empty,
  };
}

function safeParse<T>(schema: z.ZodType<T>, value: unknown): T | null {
  const result = schema.safeParse(value);
  return result.success ? result.data : null;
}

function isBlank(text: string | null): boolean {
  return text === null || text.trim() === "";
}
