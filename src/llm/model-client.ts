import type { z } from "zod";

export type ProviderId = "claude" | "glm" | "llama-cerebras";

export interface GenerateJsonInput<T> {
  systemPrompt: string;
  /**
   * Caller embeds any untrusted scraped text in a clearly delimited block
   * inside this prompt (e.g. `<scraped_data>...</scraped_data>`) — never
   * in systemPrompt. This is the same prompt-injection convention used
   * throughout the project; providers must not change that shape.
   */
  userPrompt: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
}

export interface GenerateJsonResult<T> {
  data: T | null; // null if validation failed even after one retry
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  /** True if any underlying HTTP call (including a retried one) got a 429. */
  rateLimited: boolean;
  rawText: string | null;
  /**
   * The provider's own reason the response ended (e.g. "stop"/"end_turn"
   * for a natural finish, "length"/"max_tokens" for hitting the token
   * budget). Lets a caller tell "the model ran out of room" apart from
   * "the model produced bad output" — the two look identical as a bare
   * `data: null`, but have very different fixes.
   */
  finishReason: string | null;
  /** True if finishReason indicates the response was cut off by the token budget. */
  truncated: boolean;
  /** True if the call succeeded (not rate-limited, not an HTTP error) but returned no text at all. */
  empty: boolean;
}

export interface ModelClient {
  readonly providerId: ProviderId;
  generateJSON<T>(input: GenerateJsonInput<T>): Promise<GenerateJsonResult<T>>;
}

/** Pulls the first top-level JSON object out of a model's text response. */
export function extractFirstJsonObject(text: string): unknown | null {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

export const RETRY_REMINDER =
  "Your previous response did not match the required JSON shape exactly. Return ONLY the JSON object, no other text.";
