import { mkdirSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { sampleSite } from "./fetch-site.js";
import { classifyStore } from "./classify-store.js";
import { searchCandidates } from "./search-candidates.js";
import { pickCompetitors } from "./find-competitors.js";
import { fetchNewProducts } from "./products-shopify.js";
import { fetchAds } from "./ads.js";
import { buildFindings, suggestAndCheckMoves } from "./compare-suggest-moves.js";
import { checkPromptInjectionResistance } from "./prompt-injection-check.js";
import { CostLog } from "./cost-log.js";
import {
  CostGuard,
  GLOBAL_MAX_RUN_COST_USD,
  GLOBAL_MAX_DAILY_COST_USD,
} from "../../src/lib/cost-guard.js";
import { createAllModelClients } from "../../src/llm/create-clients.js";
import type { ModelClient, ProviderId } from "../../src/llm/model-client.js";
import type { Candidate, Finding } from "./schema.js";
import { normalizeDomain } from "./domain-utils.js";

const OUT_DIR = "spike-results/model-comparison";

interface StepDiagnostics {
  step: string;
  truncated: boolean;
  empty: boolean;
}

interface ProviderResult {
  label: string; // "A" | "B" | "C" — never the provider name
  jsonValid: boolean;
  competitorPicks: Candidate[];
  picksSkippedNoCandidates: boolean;
  moves: Awaited<ReturnType<typeof suggestAndCheckMoves>>;
  promptInjection: Awaited<ReturnType<typeof checkPromptInjectionResistance>>;
  picksMatchCandidates: boolean;
  invalidPickDomains: string[];
  rateLimited429Count: number;
  costUsd: number;
  latencyMs: number;
  /**
   * Per-step truncated/empty flags, so a provider that scores badly can
   * be read as "ran out of token budget" (a budget problem, fixable by
   * raising maxTokens) rather than "produced bad output" (a quality
   * problem) — the two look identical as a bare schema-validation
   * failure otherwise.
   */
  diagnostics: StepDiagnostics[];
}

function parseArgs(argv: string[]): { store: string } {
  const storeIndex = argv.indexOf("--store");
  const store = storeIndex >= 0 ? argv[storeIndex + 1] : undefined;
  if (!store) {
    throw new Error("Usage: npm run compare-models -- --store <url>");
  }
  return { store };
}

function shuffleLabels<T>(items: Array<{ providerId: ProviderId; client: T }>): Array<{
  providerId: ProviderId;
  client: T;
  label: string;
}> {
  const labels = ["A", "B", "C"];
  const shuffled = [...items].sort(() => Math.random() - 0.5);
  return shuffled.map((item, i) => ({ ...item, label: labels[i]! }));
}

async function main() {
  const { store: storeUrl } = parseArgs(process.argv.slice(2));

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — check .env.local");
  }
  const anthropicRawClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const allClients = createAllModelClients();

  // Claude only — per docs/decisions/001-model-provider.md, GLM fabricated
  // dated findings with invented finding ids when no real data was
  // available, and ran 67-191s per store with repeated 429s. The glm and
  // llama-cerebras adapters stay in the codebase (swappable, not deleted)
  // but are not used here.
  const available: Array<{ providerId: ProviderId; client: ModelClient }> = [
    { providerId: "claude", client: allClients.claude },
  ];
  console.log(
    `Comparing ${available.length} provider(s): ${available.map((a) => a.providerId).join(", ")}`,
  );

  const labeled = shuffleLabels(available);

  mkdirSync(OUT_DIR, { recursive: true });
  const domain = new URL(storeUrl).hostname.replace(/\./g, "-");
  const costLog = new CostLog(`${OUT_DIR}/../cost-log.csv`);
  const costGuard = new CostGuard(GLOBAL_MAX_RUN_COST_USD, GLOBAL_MAX_DAILY_COST_USD);

  console.log(`[1/4] Reading ${storeUrl} ...`);
  const ownSite = await sampleSite(storeUrl);

  console.log("[2/4] Reference classification (Claude) to drive the shared search step ...");
  costGuard.checkBeforeCall(0.01);
  const { profile: referenceProfile } = await classifyStore(
    storeUrl,
    ownSite.combinedText,
    allClients.claude,
    costLog,
  );
  costGuard.recordActualSpend(costLog.rows.at(-1)?.costUsd ?? 0);

  let candidatesText = "";
  let sharedFindings: Finding[] = [];
  let candidateDomains: string[] = [];
  if (referenceProfile) {
    console.log("[3/4] Shared search + products/ads collection for all candidates ...");
    costGuard.checkBeforeCall(0.01);
    candidatesText = await searchCandidates(
      storeUrl,
      referenceProfile.category,
      referenceProfile.productKeywords,
      anthropicRawClient,
      costLog,
    );
    costGuard.recordActualSpend(costLog.rows.at(-1)?.costUsd ?? 0);

    candidateDomains = candidatesText
      .split("\n")
      .map((line) => /([a-z0-9-]+\.[a-z]{2,})/i.exec(line)?.[1])
      .filter((d): d is string => Boolean(d))
      .slice(0, 8);

    const perCompetitorForFindings: Array<{
      competitor: Candidate;
      products: Awaited<ReturnType<typeof fetchNewProducts>>;
      ads: Awaited<ReturnType<typeof fetchAds>>;
    }> = [];
    for (const d of candidateDomains) {
      const url = `https://${d}`;
      const competitor: Candidate = { domain: d, name: d, whyPicked: "shared-candidate-pool" };
      const products = await fetchNewProducts(url).catch(() => ({
        status: "not_enough_data" as const,
        reason: "fetch_error",
        dateBasis: "none" as const,
        products: [],
        sourceUrl: url,
        capturedAt: new Date().toISOString(),
      }));
      const ads = await fetchAds(d, referenceProfile.markets);
      perCompetitorForFindings.push({ competitor, products, ads });
    }
    sharedFindings = buildFindings(perCompetitorForFindings);
  } else {
    console.warn("  -> reference classification failed; skipping search/findings for this store");
  }

  console.log(
    `[4/4] Running ${labeled.length} provider(s) blind (labels assigned, mapping kept separate) ...`,
  );
  const results: ProviderResult[] = [];
  const keyMap: Record<string, ProviderId> = {};

  for (const { providerId, client, label } of labeled) {
    keyMap[label] = providerId;
    console.log(`  -> running label ${label} ...`);

    let rateLimited429Count = 0;
    let costUsd = 0;
    const diagnostics: StepDiagnostics[] = [];
    const start = performance.now();

    // Charges and 429s are read from whatever rows the step actually
    // added to costLog (it may be 0 rows on a skip, or more than 1 on an
    // internal retry) rather than assuming the LAST row belongs to this
    // step — a skip-with-no-call would otherwise silently double-count
    // the previous step's row.
    const spendSinceRow = (rowsBefore: number): { costUsd: number; rateLimited: boolean } => {
      const rows = costLog.rows.slice(rowsBefore);
      return {
        costUsd: rows.reduce((sum, r) => sum + r.costUsd, 0),
        rateLimited: rows.some((r) => r.rateLimited),
      };
    };

    costGuard.checkBeforeCall(0.01);
    const classifyRowsBefore = costLog.rows.length;
    const classifyResult = await classifyStore(storeUrl, ownSite.combinedText, client, costLog);
    const classifySpend = spendSinceRow(classifyRowsBefore);
    costUsd += classifySpend.costUsd;
    if (classifySpend.rateLimited) rateLimited429Count += 1;
    costGuard.recordActualSpend(classifySpend.costUsd);
    diagnostics.push({
      step: "classify",
      truncated: classifyResult.truncated,
      empty: classifyResult.empty,
    });

    let competitorPicks: Candidate[] = [];
    let invalidPickDomains: string[] = [];
    let picksSkippedNoCandidates = false;
    if (classifyResult.profile && candidatesText) {
      costGuard.checkBeforeCall(0.01);
      const pickRowsBefore = costLog.rows.length;
      const pickResult = await pickCompetitors(
        classifyResult.profile,
        candidatesText,
        storeUrl,
        client,
        candidateDomains,
        costLog,
      );
      competitorPicks = pickResult.candidates;
      const candidateDomainSet = new Set(candidateDomains.map(normalizeDomain));
      invalidPickDomains = competitorPicks
        .map((c) => c.domain)
        .filter((d) => !candidateDomainSet.has(normalizeDomain(d)));
      const pickSpend = spendSinceRow(pickRowsBefore);
      costUsd += pickSpend.costUsd;
      if (pickSpend.rateLimited) rateLimited429Count += 1;
      costGuard.recordActualSpend(pickSpend.costUsd);
      diagnostics.push({
        step: "pick_competitors",
        truncated: pickResult.truncated,
        empty: pickResult.empty,
      });
    } else {
      picksSkippedNoCandidates = true;
    }

    costGuard.checkBeforeCall(0.01);
    const movesRowsBefore = costLog.rows.length;
    const moves = await suggestAndCheckMoves(
      storeUrl,
      sharedFindings,
      competitorPicks,
      client,
      costLog,
    );
    const movesSpend = spendSinceRow(movesRowsBefore);
    costUsd += movesSpend.costUsd;
    if (movesSpend.rateLimited) rateLimited429Count += 1;
    costGuard.recordActualSpend(movesSpend.costUsd);
    diagnostics.push({ step: "suggest_moves", truncated: moves.truncated, empty: moves.empty });

    costGuard.checkBeforeCall(0.01);
    const promptInjection = await checkPromptInjectionResistance(client);
    costGuard.recordActualSpend(0.01); // checkPromptInjectionResistance doesn't log to costLog itself

    const result: ProviderResult = {
      label,
      jsonValid: Boolean(classifyResult.profile),
      competitorPicks,
      picksSkippedNoCandidates,
      moves,
      promptInjection,
      picksMatchCandidates: invalidPickDomains.length === 0,
      invalidPickDomains,
      rateLimited429Count,
      diagnostics,
      costUsd,
      latencyMs: performance.now() - start,
    };
    results.push(result);

    // Write this provider's result as soon as it finishes, not after the
    // whole loop — a cost-cap abort or crash on a LATER provider must not
    // discard results already earned for an EARLIER one.
    writeFileSync(
      `${OUT_DIR}/${domain}-${result.label}.json`,
      JSON.stringify(
        {
          label: result.label,
          jsonValid: result.jsonValid,
          competitorPicks: result.competitorPicks,
          picksSkippedNoCandidates: result.picksSkippedNoCandidates,
          picksMatchCandidates: result.picksMatchCandidates,
          invalidPickDomains: result.invalidPickDomains,
          movesSkippedNoFindings: result.moves.skippedNoFindings,
          moves: result.moves.moves,
          moveChecks: result.moves.moveChecks,
          movesGrounded: result.moves.skippedNoFindings
            ? "not_enough_data"
            : `${result.moves.groundedCount}/${result.moves.totalCount}`,
          distinctCompetitorsCited: result.moves.distinctCompetitorsCited,
          diversityOk: result.moves.diversityOk,
          promptInjectionResistant: result.promptInjection.pass,
          rateLimited429Count: result.rateLimited429Count,
          costUsd: result.costUsd,
          latencyMs: Math.round(result.latencyMs),
          // Per-step truncated/empty — read this before concluding a low
          // score means bad quality. A "yes" here means the token budget
          // cut the response short or it came back blank, which is a
          // budget problem (raise maxTokens), not a quality problem.
          diagnostics: result.diagnostics,
        },
        null,
        2,
      ),
    );
    // The key file is rewritten after every provider so a partial run
    // still has a key covering whichever labels did get written.
    writeFileSync(`${OUT_DIR}/${domain}-key.json`, JSON.stringify(keyMap, null, 2));
  }

  const tableRows = results
    .map((r) => {
      const anyTruncated = r.diagnostics.some((d) => d.truncated);
      const anyEmpty = r.diagnostics.some((d) => d.empty);
      const budgetFlag = anyTruncated || anyEmpty ? (anyTruncated ? "truncated" : "empty") : "ok";
      const movesCell = r.moves.skippedNoFindings
        ? "not_enough_data"
        : `${r.moves.groundedCount}/${r.moves.totalCount}`;
      const picksCell = r.picksSkippedNoCandidates
        ? "not_enough_data"
        : r.picksMatchCandidates
          ? "yes"
          : `NO (${r.invalidPickDomains.join(", ")})`;
      return `| ${r.label} | ${r.jsonValid ? "yes" : "no"} | ${picksCell} | $${r.costUsd.toFixed(4)} | ${Math.round(r.latencyMs)}ms | ${r.rateLimited429Count} | ${budgetFlag} | ${r.promptInjection.pass ? "pass" : "FAIL"} | ${movesCell} |  |  |`;
    })
    .join("\n");

  const markdown = `# Model comparison — ${domain}

| Label | JSON valid | Picks match candidates | Cost | Latency | 429s | Budget (see JSON for which step) | Injection resistant | Moves auto-grounded (strict) | Picks accepted (fill in) | Moves grounded, human read (fill in) |
|-------|-----------|--------------------------|------|---------|------|-----------------------------------|----------------------|----------------------------------|---------------------------|----------------------------------------|
${tableRows}

"Moves auto-grounded" now requires: the cited finding to exist, belong to
one of THIS provider's 3 picked competitors, have every quoted/named
brand or domain in the move text match that same finding, have no
unsupported claim words ("successful", "best-selling", "trend",
"popular", etc.), and have any date in the move text actually present in
the cited finding. See each \`${domain}-<label>.json\`'s \`moveChecks\`
array for the specific reason(s) a move failed.

"Budget" flags truncated/empty responses — a provider can score low on
JSON validity or grounding purely because a response got cut off by the
token budget, which is a budget problem (raise maxTokens), not a
quality problem. Check each \`${domain}-<label>.json\`'s \`diagnostics\`
array for which specific step (classify / pick_competitors /
suggest_moves) was affected before reading that provider's score as a
quality signal.

Score the two blank columns by reading each \`${domain}-<label>.json\` file
WITHOUT opening \`${domain}-key.json\` first. Open the key file only after
scoring is done, to reveal which label was which provider.
`;
  writeFileSync(`${OUT_DIR}/${domain}-comparison.md`, markdown);

  console.log(`\nDone. Blind results in ${OUT_DIR}/${domain}-{A,B,C}.json`);
  console.log(`Key (open AFTER scoring): ${OUT_DIR}/${domain}-key.json`);
  console.log(`Summary table: ${OUT_DIR}/${domain}-comparison.md`);
  console.log(`Total run cost: $${costGuard.runTotalSoFarUsd().toFixed(4)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
