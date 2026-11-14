import type { ModelClient } from "../../src/llm/model-client.js";
import { MoveListSchema, type Candidate, type Finding, type Move } from "./schema.js";
import type { ProductsResult, AdsResult } from "./schema.js";
import { normalizeDomain } from "./domain-utils.js";
import type { CostLog } from "./cost-log.js";

/**
 * Builds the fixed, provider-independent list of citable findings for a
 * store's competitors — held constant across all three ModelClients so
 * the moves comparison only varies the reasoning model, same principle
 * as pickCompetitors's shared candidate list.
 *
 * This is comparison-only scaffolding, not the Phase 3 Suggester: it
 * exists purely to let compare-models.ts score "moves that cite real
 * findings" per provider. The real Suggester gets designed fresh in
 * Phase 3 with its own finding/citation model.
 */
export function buildFindings(
  perCompetitor: Array<{ competitor: Candidate; products: ProductsResult; ads: AdsResult }>,
): Finding[] {
  const findings: Finding[] = [];
  for (const { competitor, products, ads } of perCompetitor) {
    products.products.forEach((p, i) => {
      findings.push({
        id: `${competitor.domain}-product-${i}`,
        competitorDomain: competitor.domain,
        kind: "product",
        summary: `${competitor.domain} ${products.dateBasis === "real_dates" ? "launched" : "lists"} "${p.title}"${p.publishedAt ? ` (published ${p.publishedAt})` : ""}`,
        url: p.url,
        date: p.publishedAt,
      });
    });
    ads.ads.forEach((ad, i) => {
      findings.push({
        id: `${competitor.domain}-ad-${i}`,
        competitorDomain: competitor.domain,
        kind: "ad",
        summary: `${competitor.domain} has an ad running${ad.daysRunning !== null ? ` for ~${ad.daysRunning} days` : ""}: "${ad.adText.slice(0, 100)}"`,
        url: ad.adUrl,
        date: ad.startDate,
      });
    });
  }
  return findings;
}

const SYSTEM_PROMPT = `You suggest specific moves an e-commerce store owner
could make in response to their competitors' activity. Return EXACTLY 3
moves. Across all 3 moves together, cite findings from at least 2
different competitors — do not build all 3 moves around the same single
competitor. For each move, give three fields:
- competitorObservation: a short, factual statement of what one or two
  competitors did, citing 1 or 2 finding ids from the list provided (an
  ad finding and a product finding can be combined in one move). Never
  invent a finding id that isn't in the list. Every brand, product name,
  and date in this field must come directly from the cited finding(s) —
  do not add any brand, product name, or date that isn't in them. State
  ONLY what was launched or run, and when — never WHY. Do not interpret
  or guess the competitor's motive or strategy. For example, never
  write "addressing demand for X", "responding to Y", or "to capture Z"
  — just state the fact: what launched/ran, and the date.
- citedFindingIds: an array of EXACTLY 1 or 2 finding ids, never more,
  exactly as they appear in the list (no brackets). If a competitor
  launched several products on the same day, do not cite all of them —
  pick only the single most notable one (or at most one more) and
  summarize the rest in your own words without citing their ids. A
  citedFindingIds array with 3 or more entries is invalid and will be
  rejected.
- suggestion: what the store owner could do in response. Address the
  owner directly as "you"/"your" — never by the store's own name, even
  though you know it. For example write "Create a bundle for your curl
  care line", never "Create a bundle for Sienna Naturals' curl care
  line". You may invent a name for the owner's OWN new product or
  bundle here. Do not name any competitor other than the one(s) in
  citedFindingIds. Do not use hype or unsupported-claim words like
  "successful", "best-selling", "trend", or "popular".
Return the 3 moves as JSON.`;

const SCHEMA_DESCRIPTION = `{
  "moves": [
    { "competitorObservation": string, "citedFindingIds": string[] (1 or 2 items), "suggestion": string }
  ]
}`;

const DIVERSITY_RETRY_NOTE = `

Your previous 3 moves cited only one competitor across all of them. Keep
exactly 3 moves, but make sure that across all 3, findings from at least
2 different competitors are cited.`;

const UNSUPPORTED_CLAIM_WORDS = [
  "successful",
  "best-selling",
  "bestselling",
  "best seller",
  "trend",
  "trending",
  "popular",
  "leading",
  "booming",
  "viral",
];

// competitorObservation must state only what happened and when — never
// WHY. These words/phrases signal the model guessing at motive or
// strategy instead of reporting a fact.
const INTERPRETIVE_WORDS = ["demand", "addressing", "to capture", "responding to"];

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const MONTH_NAMES = MONTHS.join("|");
// "November 6, 2026" / "November 6 2026" — a year is required, since a
// bare "November 6" can't be turned into a comparable calendar date.
const MONTH_DATE_PATTERN = new RegExp(`\\b(${MONTH_NAMES})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, "gi");
// No trailing \b: an ISO datetime like "2026-09-23T13:12:58-04:00" has no
// word-boundary between the date and the immediately-following "T" (both
// are word characters), so a trailing \b would silently fail to match it.
const ISO_DATE_PATTERN = /\b(\d{4})-(\d{2})-(\d{2})(?!\d)/g;
const QUOTED_PATTERN = /'([^']{2,80})'|"([^"]{2,80})"/g;
const DOMAIN_PATTERN = /\b[a-z0-9-]+\.(?:com|us|co|net|io|shop)\b/gi;

function extractQuotedPhrases(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(QUOTED_PATTERN)) {
    out.push(m[1] ?? m[2] ?? "");
  }
  return out.filter(Boolean);
}

function extractDomainMentions(text: string): string[] {
  return [...new Set((text.match(DOMAIN_PATTERN) ?? []).map((d) => normalizeDomain(d)))];
}

/**
 * Extracts calendar dates as normalized "YYYY-MM-DD" keys, so "November
 * 6, 2026" and "2026-11-06T13:02:19-07:00" compare equal as the same
 * calendar day instead of failing on a pure substring match. A date
 * mentioned without a year (e.g. a bare "November 6") is skipped — there
 * is nothing to safely compare it against.
 */
function extractDateKeys(text: string): string[] {
  const keys = new Set<string>();
  for (const m of text.matchAll(ISO_DATE_PATTERN)) {
    keys.add(`${m[1]}-${m[2]}-${m[3]}`);
  }
  for (const m of text.matchAll(MONTH_DATE_PATTERN)) {
    const monthIndex = MONTHS.indexOf(m[1]!.toLowerCase());
    const day = m[2]!.padStart(2, "0");
    const year = m[3]!;
    keys.add(`${year}-${String(monthIndex + 1).padStart(2, "0")}-${day}`);
  }
  return [...keys];
}

function findUnsupportedClaims(text: string): string[] {
  const lower = text.toLowerCase();
  return UNSUPPORTED_CLAIM_WORDS.filter((word) => lower.includes(word));
}

function findInterpretiveLanguage(text: string): string[] {
  const lower = text.toLowerCase();
  return INTERPRETIVE_WORDS.filter((word) => lower.includes(word));
}

/** Strips brackets/whitespace models sometimes copy from the "- [id] summary" prompt format. */
function normalizeFindingId(raw: string): string {
  return raw.trim().replace(/^\[+/, "").replace(/\]+$/, "").trim();
}

export interface MoveCheckDetail {
  competitorObservation: string;
  citedFindingIds: string[];
  suggestion: string;
  grounded: boolean;
  reasons: string[];
}

export interface MovesCheckResult {
  moves: Move[];
  moveChecks: MoveCheckDetail[];
  groundedCount: number;
  totalCount: number;
  allGrounded: boolean;
  /** Distinct competitors cited across all 3 moves together. */
  distinctCompetitorsCited: number;
  /** True once at least 2 different competitors are cited across the 3 moves. */
  diversityOk: boolean;
  rateLimited: boolean;
  /** True if the response was cut off by the token budget (not a quality failure). */
  truncated: boolean;
  /** True if the call succeeded but returned no text at all. */
  empty: boolean;
  /** True if the model call was skipped because there were no findings for any picked competitor. */
  skippedNoFindings: boolean;
}

/**
 * Asks a provider for exactly 3 moves citing 1-2 findings each from the
 * fixed list, then checks each move against the "reject ungrounded
 * suggestions" rule GUARDRAILS.md requires. The strict grounding check
 * (1-5 below) applies only to `competitorObservation`, since that's the
 * field claiming facts about the competitor(s). `suggestion` is the
 * owner's own hypothetical move, so it may invent names for the owner's
 * own new products — it only fails for hype/unsupported-claim words or
 * for naming a competitor NOT among those cited.
 *
 * A move is grounded only if ALL of the following hold:
 *   1. every id in citedFindingIds exists in the fixed findings list
 *      (brackets/whitespace stripped before comparing).
 *   2. every cited finding's competitor is one of this provider's own
 *      picks (not just any candidate from the shared pool).
 *   3. any domain, brand, or product name quoted/mentioned in
 *      competitorObservation matches one of the cited findings, not an
 *      uncited competitor.
 *   4. competitorObservation contains no unsupported superlative/trend
 *      claims.
 *   5. any date mentioned in competitorObservation actually appears in
 *      at least one of the cited findings' summaries.
 *   6. suggestion contains no unsupported superlative/trend claims.
 *   7. suggestion does not name any competitor domain/brand other than
 *      the one(s) cited.
 * Separately, across all 3 moves together, at least 2 distinct
 * competitors must be cited — checked after generation and retried once
 * if not met (see DIVERSITY_RETRY_NOTE), reported either way as
 * `distinctCompetitorsCited`/`diversityOk` rather than looped forever.
 */
export async function suggestAndCheckMoves(
  storeUrl: string,
  allFindings: Finding[],
  pickedCompetitors: Candidate[],
  client: ModelClient,
  costLog?: CostLog,
  ownBrandName?: string | null,
): Promise<MovesCheckResult> {
  const ownDomain = normalizeDomain(new URL(storeUrl).hostname);
  const pickedDomains = new Set(pickedCompetitors.map((c) => normalizeDomain(c.domain)));
  const otherCompetitorNamesByDomain = new Map<string, string[]>();
  for (const picked of pickedCompetitors) {
    otherCompetitorNamesByDomain.set(
      normalizeDomain(picked.domain),
      pickedCompetitors
        .filter((c) => normalizeDomain(c.domain) !== normalizeDomain(picked.domain))
        .map((c) => c.name),
    );
  }

  // The moves step only ever sees findings belonging to one of THIS
  // provider's 3 confirmed picks — not the whole shared candidate pool —
  // so a model can't cite (or hallucinate about) a competitor it never
  // actually picked.
  const findings = allFindings.filter((f) =>
    pickedDomains.has(normalizeDomain(f.competitorDomain)),
  );

  if (findings.length === 0) {
    return {
      moves: [],
      moveChecks: [],
      groundedCount: 0,
      totalCount: 0,
      allGrounded: false,
      distinctCompetitorsCited: 0,
      diversityOk: false,
      rateLimited: false,
      truncated: false,
      empty: false,
      skippedNoFindings: true,
    };
  }

  const findingsText = findings.map((f) => `- [${f.id}] ${f.summary}`).join("\n");
  const findingsById = new Map(findings.map((f) => [f.id, f]));

  function evaluateMoves(moves: Move[]): {
    moveChecks: MoveCheckDetail[];
    distinctCompetitorsCited: number;
  } {
    const allCitedDomains = new Set<string>();

    const moveChecks: MoveCheckDetail[] = moves.map((m) => {
      const reasons: string[] = [];
      const citedFindings = m.citedFindingIds
        .map((id) => findingsById.get(normalizeFindingId(id)))
        .filter((f): f is Finding => f !== undefined);

      for (const id of m.citedFindingIds) {
        if (!findingsById.has(normalizeFindingId(id))) {
          reasons.push(`cited finding id "${id}" does not exist`);
        }
      }

      const citedDomains = new Set(citedFindings.map((f) => normalizeDomain(f.competitorDomain)));
      for (const d of citedDomains) allCitedDomains.add(d);

      for (const finding of citedFindings) {
        const findingDomain = normalizeDomain(finding.competitorDomain);
        if (!pickedDomains.has(findingDomain)) {
          reasons.push(
            `cited finding belongs to ${finding.competitorDomain}, which is not one of this provider's 3 picked competitors`,
          );
        }
      }

      if (citedFindings.length > 0) {
        // Strict checks — applied to competitorObservation, the field
        // claiming facts about the competitor(s). A move can cite up to 2
        // findings now, so a quoted phrase or date only needs to match
        // ONE of the cited findings' summaries, not all of them — but a
        // mentioned domain must be one of the cited competitors (or the
        // owner's own domain), never an uncited one.
        const allowedDomains = new Set([...citedDomains, ownDomain]);
        for (const domain of extractDomainMentions(m.competitorObservation)) {
          if (!allowedDomains.has(domain)) {
            reasons.push(
              `observation names domain "${domain}", which isn't among the cited findings`,
            );
          }
        }

        const summaries = citedFindings.map((f) => f.summary);
        for (const phrase of extractQuotedPhrases(m.competitorObservation)) {
          if (!summaries.some((s) => s.includes(phrase))) {
            reasons.push(
              `quoted text "${phrase}" in the observation does not appear in any cited finding`,
            );
          }
        }

        const citedDateKeys = new Set(summaries.flatMap((s) => extractDateKeys(s)));
        for (const dateKey of extractDateKeys(m.competitorObservation)) {
          if (!citedDateKeys.has(dateKey)) {
            reasons.push(
              `date "${dateKey}" in the observation is not present in any cited finding`,
            );
          }
        }

        const observationClaims = findUnsupportedClaims(m.competitorObservation);
        if (observationClaims.length > 0) {
          reasons.push(`observation unsupported claim word(s): ${observationClaims.join(", ")}`);
        }

        const interpretive = findInterpretiveLanguage(m.competitorObservation);
        if (interpretive.length > 0) {
          reasons.push(
            `observation contains interpretive language (states why, not just what/when): ${interpretive.join(", ")}`,
          );
        }

        // Light check — applies only to suggestion. Invented names for the
        // owner's own new products/bundles are allowed here; only flag
        // hype words and mentions of a competitor NOT among those cited.
        const suggestionClaims = findUnsupportedClaims(m.suggestion);
        if (suggestionClaims.length > 0) {
          reasons.push(`suggestion unsupported claim word(s): ${suggestionClaims.join(", ")}`);
        }

        if (ownBrandName && m.suggestion.toLowerCase().includes(ownBrandName.toLowerCase())) {
          reasons.push(
            `suggestion addresses the owner by store name ("${ownBrandName}") instead of "you"/"your"`,
          );
        }

        for (const domain of extractDomainMentions(m.suggestion)) {
          if (!allowedDomains.has(domain)) {
            reasons.push(
              `suggestion names domain "${domain}", which isn't among the cited competitors`,
            );
          }
        }

        for (const citedDomain of citedDomains) {
          const otherNames = otherCompetitorNamesByDomain.get(citedDomain) ?? [];
          for (const otherName of otherNames) {
            if (
              otherName &&
              !citedDomains.has(normalizeDomain(otherName)) &&
              m.suggestion.toLowerCase().includes(otherName.toLowerCase())
            ) {
              reasons.push(
                `suggestion names a picked competitor ("${otherName}") not among those cited`,
              );
            }
          }
        }
      }

      return {
        competitorObservation: m.competitorObservation,
        citedFindingIds: m.citedFindingIds,
        suggestion: m.suggestion,
        grounded: reasons.length === 0,
        reasons,
      };
    });

    return { moveChecks, distinctCompetitorsCited: allCitedDomains.size };
  }

  const start = performance.now();
  let callCount = 1;
  let result = await client.generateJSON({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: `Store: ${storeUrl}

Findings:
${findingsText}

Return JSON matching exactly:
${SCHEMA_DESCRIPTION}`,
    schema: MoveListSchema,
  });
  let tokensIn = result.tokensIn;
  let tokensOut = result.tokensOut;
  let costUsd = result.costUsd;
  let rateLimited = result.rateLimited;

  let moves = result.data?.moves ?? [];
  let { moveChecks, distinctCompetitorsCited } = evaluateMoves(moves);

  if (distinctCompetitorsCited < 2 && pickedDomains.size >= 2 && !result.rateLimited) {
    callCount += 1;
    result = await client.generateJSON({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: `Store: ${storeUrl}

Findings:
${findingsText}

Return JSON matching exactly:
${SCHEMA_DESCRIPTION}${DIVERSITY_RETRY_NOTE}`,
      schema: MoveListSchema,
    });
    tokensIn += result.tokensIn;
    tokensOut += result.tokensOut;
    costUsd += result.costUsd;
    rateLimited = rateLimited || result.rateLimited;
    moves = result.data?.moves ?? moves;
    ({ moveChecks, distinctCompetitorsCited } = evaluateMoves(moves));
  }

  costLog?.record({
    storeUrl,
    step: "suggest_moves_comparison_only",
    provider: client.providerId,
    calls: callCount,
    tokensIn,
    tokensOut,
    costUsd,
    durationMs: performance.now() - start,
    rateLimited,
  });

  const groundedCount = moveChecks.filter((c) => c.grounded).length;

  return {
    moves,
    moveChecks,
    distinctCompetitorsCited,
    diversityOk: distinctCompetitorsCited >= 2,
    groundedCount,
    totalCount: moves.length,
    allGrounded: moves.length > 0 && groundedCount === moves.length,
    rateLimited,
    truncated: result.truncated,
    empty: result.empty,
    skippedNoFindings: false,
  };
}
