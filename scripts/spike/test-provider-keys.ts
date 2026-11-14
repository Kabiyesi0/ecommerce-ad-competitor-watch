import { z } from "zod";
import { createAllModelClients } from "../../src/llm/create-clients.js";
import type { ModelClient } from "../../src/llm/model-client.js";

/**
 * Smallest possible call to each configured provider, just to confirm a
 * key actually works and to show the real measured cost — not part of
 * the spike or comparison pipeline. Skips any provider whose key is
 * empty in .env.local, same convention as compare-models.ts.
 */
const PingSchema = z.object({ ok: z.literal(true) });

async function testOne(label: string, client: ModelClient): Promise<number> {
  const result = await client.generateJSON({
    systemPrompt: "Reply with nothing but the JSON object requested.",
    userPrompt: 'Return exactly this JSON: {"ok": true}',
    schema: PingSchema,
    // GLM-4.7-Flash emits visible chain-of-thought reasoning tokens before
    // its actual answer (confirmed empirically — a 16-32 token budget was
    // consumed entirely by reasoning, leaving an empty final message), so
    // this needs real headroom past the reasoning phase to get content.
    maxTokens: 300,
  });

  if (result.data) {
    console.log(
      `${label}: OK — tokens in=${result.tokensIn} out=${result.tokensOut}, cost=$${result.costUsd.toFixed(6)}, latency=${Math.round(result.latencyMs)}ms`,
    );
  } else {
    console.log(
      `${label}: FAILED — no valid JSON returned${result.rateLimited ? " (rate limited)" : ""}. Raw response: ${result.rawText?.slice(0, 200) ?? "(none)"}`,
    );
  }
  return result.costUsd;
}

async function main() {
  const clients = createAllModelClients();
  let totalCostUsd = 0;

  totalCostUsd += await testOne("claude", clients.claude);

  if (clients.glm) {
    totalCostUsd += await testOne("glm", clients.glm);
  } else {
    console.log("glm: skipped — ZAI_API_KEY is empty in .env.local");
  }

  if (clients.llamaCerebras) {
    totalCostUsd += await testOne("llama-cerebras", clients.llamaCerebras);
  } else {
    console.log("llama-cerebras: skipped — CEREBRAS_API_KEY is empty in .env.local");
  }

  console.log(`\nTotal cost for this test: $${totalCostUsd.toFixed(6)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
