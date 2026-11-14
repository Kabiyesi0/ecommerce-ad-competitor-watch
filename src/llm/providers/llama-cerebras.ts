import type { GenerateJsonInput, GenerateJsonResult, ModelClient } from "../model-client.js";
import { generateJsonViaOpenAiCompatible } from "./openai-compatible.js";

// Base URL per Cerebras's OpenAI-compatible API (inference-docs.cerebras.ai)
// as of planning time. The Llama model id is genuinely unsettled across
// sources checked during planning — some list "llama-3.3-70b", a more
// recent third-party catalog snapshot omitted it in favor of Llama 4
// Scout. CEREBRAS_MODEL_ID lets this be corrected without a code change
// once the current catalog is confirmed at run time; default below is a
// best guess to be verified before the first real call.
const BASE_URL = "https://api.cerebras.ai/v1";
const DEFAULT_MODEL = "llama-3.3-70b";

// Cerebras's free tier has historically included $5 of credit after a
// verified payment method is added, not a true no-card free tier —
// confirm this against current docs before assuming $0 marginal cost,
// per the plan's pre-flight check. Pricing below is Cerebras's published
// pay-as-you-go rate as a placeholder; update once confirmed.
const PRICING_USD_PER_MTOK = { input: 0.6, output: 1.2 };

export class LlamaCerebrasModelClient implements ModelClient {
  readonly providerId = "llama-cerebras" as const;
  private readonly model: string;

  constructor(
    private readonly apiKey: string,
    model = process.env.CEREBRAS_MODEL_ID ?? DEFAULT_MODEL,
  ) {
    this.model = model;
  }

  generateJSON<T>(input: GenerateJsonInput<T>): Promise<GenerateJsonResult<T>> {
    return generateJsonViaOpenAiCompatible(
      {
        baseUrl: BASE_URL,
        apiKey: this.apiKey,
        model: this.model,
        pricingUsdPerMtok: PRICING_USD_PER_MTOK,
      },
      input,
    );
  }
}
