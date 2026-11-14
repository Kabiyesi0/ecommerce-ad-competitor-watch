import { mkdirSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { sampleSite } from "./fetch-site.js";
import { classifyStore } from "./classify-store.js";
import { searchCandidates } from "./search-candidates.js";
import { pickCompetitors } from "./find-competitors.js";
import { fetchNewProducts } from "./products-shopify.js";
import { fetchAds } from "./ads.js";
import { CostLog } from "./cost-log.js";
import { createAllModelClients } from "../../src/llm/create-clients.js";
import type { ModelClient, ProviderId } from "../../src/llm/model-client.js";
import {
  CostGuard,
  GLOBAL_MAX_RUN_COST_USD,
  GLOBAL_MAX_DAILY_COST_USD,
} from "../../src/lib/cost-guard.js";
import type { Candidate, SpikeStoreResult } from "./schema.js";

const OUT_DIR = "spike-results";

function parseArgs(argv: string[]): { store: string; provider: ProviderId } {
  const storeIndex = argv.indexOf("--store");
  const providerIndex = argv.indexOf("--provider");
  const store = storeIndex >= 0 ? argv[storeIndex + 1] : undefined;
  const provider = (providerIndex >= 0 ? argv[providerIndex + 1] : "claude") as ProviderId;
  if (!store) {
    throw new Error("Usage: npm run spike -- --store <url> [--provider claude|glm|llama-cerebras]");
  }
  if (!["claude", "glm", "llama-cerebras"].includes(provider)) {
    throw new Error("--provider must be claude, glm, or llama-cerebras");
  }
  return { store, provider };
}

function pickClient(
  provider: ProviderId,
  clients: ReturnType<typeof createAllModelClients>,
): ModelClient {
  if (provider === "claude") return clients.claude;
  if (provider === "glm") {
    if (!clients.glm) throw new Error("--provider glm requires ZAI_API_KEY in .env.local");
    return clients.glm;
  }
  if (!clients.llamaCerebras) {
    throw new Error("--provider llama-cerebras requires CEREBRAS_API_KEY in .env.local");
  }
  return clients.llamaCerebras;
}

async function main() {
  const { store: storeUrl, provider } = parseArgs(process.argv.slice(2));

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — check .env.local");
  }
  const anthropicRawClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const client = pickClient(provider, createAllModelClients());

  mkdirSync(OUT_DIR, { recursive: true });
  const costLog = new CostLog(`${OUT_DIR}/cost-log.csv`);
  const costGuard = new CostGuard(GLOBAL_MAX_RUN_COST_USD, GLOBAL_MAX_DAILY_COST_USD);

  console.log(`[1/4] Reading ${storeUrl} ...`);
  const ownSite = await sampleSite(storeUrl);

  console.log(`[2/4] Classifying store (provider: ${provider}) ...`);
  costGuard.checkBeforeCall(0.01); // conservative pre-call estimate; real cost recorded after
  const classifyResult = await classifyStore(storeUrl, ownSite.combinedText, client, costLog);
  const profile = classifyResult.profile;
  costGuard.recordActualSpend(costLog.rows.at(-1)?.costUsd ?? 0);
  if (!profile) {
    const reason = classifyResult.truncated
      ? "response was truncated by the token budget"
      : classifyResult.empty
        ? "response was empty"
        : "response did not match the schema";
    console.warn(
      `  -> classification failed twice (${reason}); continuing with no profile (not enough data)`,
    );
  } else {
    console.log(`  -> category=${profile.category} priceTier=${profile.priceTier}`);
  }

  console.log("[3/4] Searching for and picking competitors ...");
  let candidates: Candidate[] = [];
  if (profile) {
    costGuard.checkBeforeCall(0.01);
    const candidatesText = await searchCandidates(
      storeUrl,
      profile.category,
      profile.productKeywords,
      anthropicRawClient,
      costLog,
    );
    costGuard.recordActualSpend(costLog.rows.at(-1)?.costUsd ?? 0);

    const candidateDomains = candidatesText
      .split("\n")
      .map((line) => /([a-z0-9-]+\.[a-z]{2,})/i.exec(line)?.[1])
      .filter((d): d is string => Boolean(d))
      .slice(0, 8);

    costGuard.checkBeforeCall(0.01);
    const pickResult = await pickCompetitors(
      profile,
      candidatesText,
      storeUrl,
      client,
      candidateDomains,
      costLog,
    );
    costGuard.recordActualSpend(costLog.rows.at(-1)?.costUsd ?? 0);
    candidates = pickResult.candidates;
    if (pickResult.truncated) {
      console.warn(
        "  -> pick-competitors response was truncated by the token budget, not necessarily a bad pick",
      );
    }
    if (pickResult.empty) {
      console.warn("  -> pick-competitors response was empty");
    }
  }
  console.log(
    `  -> found ${candidates.length} candidate(s): ${candidates.map((c) => c.domain).join(", ")}`,
  );

  console.log("[4/4] Collecting products + ads per competitor ...");
  const perCompetitor: SpikeStoreResult["perCompetitor"] = [];
  for (const competitor of candidates) {
    const competitorUrl = competitor.domain.startsWith("http")
      ? competitor.domain
      : `https://${competitor.domain}`;
    console.log(`  -> ${competitor.domain}`);

    const products = await fetchNewProducts(competitorUrl).catch((err) => ({
      status: "not_enough_data" as const,
      reason: `fetch_error: ${err instanceof Error ? err.message : "unknown"}`,
      dateBasis: "none" as const,
      products: [],
      sourceUrl: competitorUrl,
      capturedAt: new Date().toISOString(),
    }));

    const ads = await fetchAds(competitor.domain, profile?.markets ?? []);

    perCompetitor.push({ competitor, products, ads });
  }

  const result: SpikeStoreResult = {
    storeUrl,
    capturedAt: new Date().toISOString(),
    profile,
    providerUsed: profile ? provider : "none",
    competitors: candidates,
    perCompetitor,
  };

  const domain = new URL(storeUrl).hostname.replace(/\./g, "-");
  const outPath = `${OUT_DIR}/${domain}-${Date.now()}.json`;
  writeFileSync(outPath, JSON.stringify(result, null, 2));

  console.log(`\nDone. Result written to ${outPath}`);
  console.log(
    `Run cost: $${costGuard.runTotalSoFarUsd().toFixed(4)} over ${Math.round(costLog.totalDurationMs())}ms of model calls`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
