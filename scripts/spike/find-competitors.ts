import type { ModelClient } from "../../src/llm/model-client.js";
import { CandidateListSchema, type Candidate, type StoreProfile } from "./schema.js";
import { normalizeDomain } from "./domain-utils.js";
import type { CostLog } from "./cost-log.js";

const SYSTEM_PROMPT = `You pick real e-commerce competitor stores from a
provided list of search candidates. Only pick candidates that are real
storefronts comparable in category and price tier to the store described
— never invent a competitor that isn't in the candidate list. Reject
marketplaces, directories, blogs and review sites even if they appear in
the list. Return exactly up to 3 picks as JSON.`;

const SCHEMA_DESCRIPTION = `{
  "candidates": [
    { "domain": string, "name": string, "whyPicked": string }
  ]
}`;

export interface PickCompetitorsResult {
  candidates: Candidate[];
  rateLimited: boolean;
  /** True if the response was cut off by the token budget (not a quality failure). */
  truncated: boolean;
  /** True if the call succeeded but returned no text at all. */
  empty: boolean;
}

/**
 * Each ModelClient independently picks/ranks up to 3 competitors from
 * the SAME fixed candidate list (gathered once per store by
 * search-candidates.ts) — this is what makes the model comparison fair:
 * only the reasoning model varies, not the underlying search data.
 */
/**
 * Rejects any pick whose domain isn't in the candidate pool (never trust
 * a model-invented domain, even a plausible-looking one), retrying once
 * with the invalid domain(s) named explicitly, then hard-filters any
 * still-invalid picks out of the final result as a last resort.
 */
export async function pickCompetitors(
  profile: StoreProfile,
  candidatesText: string,
  storeUrl: string,
  client: ModelClient,
  candidateDomains: string[],
  costLog?: CostLog,
): Promise<PickCompetitorsResult> {
  const start = performance.now();
  const candidateDomainSet = new Set(candidateDomains.map(normalizeDomain));

  const basePrompt = `Store: ${storeUrl}
Category: ${profile.category}. Price tier: ${profile.priceTier}. Sells: ${profile.productKeywords.join(", ")}.

Candidates found by search:
${candidatesText}

Pick up to 3 from the list above. Return JSON matching exactly:
${SCHEMA_DESCRIPTION}`;

  let calls = 1;
  let result = await client.generateJSON({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: basePrompt,
    schema: CandidateListSchema,
  });
  let tokensIn = result.tokensIn;
  let tokensOut = result.tokensOut;
  let costUsd = result.costUsd;
  let rateLimited = result.rateLimited;
  let candidates = result.data?.candidates ?? [];
  const invalid = candidates.filter((c) => !candidateDomainSet.has(normalizeDomain(c.domain)));

  if (invalid.length > 0 && !result.rateLimited) {
    console.error(
      `[pickCompetitors] rejected pick(s) not in the candidate pool: ${invalid.map((c) => c.domain).join(", ")} — retrying once`,
    );
    calls += 1;
    const retryPrompt = `${basePrompt}

Your previous picks included domain(s) NOT in the candidate list above:
${invalid.map((c) => c.domain).join(", ")}
Pick ONLY domains that appear verbatim in the candidate list.`;
    result = await client.generateJSON({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: retryPrompt,
      schema: CandidateListSchema,
    });
    tokensIn += result.tokensIn;
    tokensOut += result.tokensOut;
    costUsd += result.costUsd;
    rateLimited = rateLimited || result.rateLimited;
    candidates = result.data?.candidates ?? [];
  }

  const stillInvalid = candidates.filter((c) => !candidateDomainSet.has(normalizeDomain(c.domain)));
  if (stillInvalid.length > 0) {
    console.error(
      `[pickCompetitors] dropping pick(s) still outside the candidate pool after retry: ${stillInvalid.map((c) => c.domain).join(", ")}`,
    );
  }
  const validCandidates = candidates.filter((c) =>
    candidateDomainSet.has(normalizeDomain(c.domain)),
  );

  costLog?.record({
    storeUrl,
    step: "pick_competitors",
    provider: client.providerId,
    calls,
    tokensIn,
    tokensOut,
    costUsd,
    durationMs: performance.now() - start,
    rateLimited,
  });

  return {
    candidates: validCandidates,
    rateLimited,
    truncated: result.truncated,
    empty: result.empty,
  };
}
