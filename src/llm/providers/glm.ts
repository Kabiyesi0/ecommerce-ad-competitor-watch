import type { GenerateJsonInput, GenerateJsonResult, ModelClient } from "../model-client.js";
import { generateJsonViaOpenAiCompatible } from "./openai-compatible.js";

// Base URL confirmed directly against docs.z.ai/api-reference/llm/chat-completion
// (2026-11-07): server https://api.z.ai/api + path /paas/v4/chat/completions,
// i.e. this base + "/chat/completions". Pricing confirmed on
// docs.z.ai/guides/overview/pricing: GLM-4.7-Flash is listed as fully
// free (input/output/cached), distinct from the paid GLM-4.7-FlashX.
//
// Model id CONFIRMED (2026-11-07, live call): "glm-4.7-flash" is a valid,
// distinct, free model id — the API response echoed back
// model: "glm-4.7-flash" with real usage numbers. The chat-completion
// model enum on docs.z.ai doesn't list it, so the docs are stale/incomplete
// here, not the id being wrong.
const BASE_URL = "https://api.z.ai/api/paas/v4";
const MODEL = "glm-4.7-flash";
const PRICING_USD_PER_MTOK = { input: 0, output: 0 };

// GLM-4.7 defaults to "thinking" on (visible chain-of-thought before the
// answer). Confirmed empirically (2026-11-07): with thinking enabled, a
// trivial request spent all 16-32 output tokens on reasoning and
// returned empty content (finish_reason: "length"); with
// thinking.type: "disabled", the same request returned the correct
// answer in 6 completion tokens with reasoning_tokens: 0 and
// finish_reason: "stop". Z.ai's own docs conflict on whether GLM-4.7 can
// disable thinking (the API reference says GLM-4.7 "will think
// compulsorily" when thinking is enabled; the separate Thinking Mode
// guide says it can be disabled per-request) — live behavior sides with
// the guide, so this is kept off by default for the structured-extraction
// tasks this project uses GLM for. A higher default token budget (see
// openai-compatible.ts) stays in place as a second safety net regardless,
// in case a future prompt needs more than disabled-thinking produces.
const THINKING_DISABLED = { thinking: { type: "disabled" } };

export class GlmModelClient implements ModelClient {
  readonly providerId = "glm" as const;

  constructor(private readonly apiKey: string) {}

  generateJSON<T>(input: GenerateJsonInput<T>): Promise<GenerateJsonResult<T>> {
    return generateJsonViaOpenAiCompatible(
      {
        baseUrl: BASE_URL,
        apiKey: this.apiKey,
        model: MODEL,
        pricingUsdPerMtok: PRICING_USD_PER_MTOK,
        extraBody: THINKING_DISABLED,
      },
      input,
    );
  }
}
