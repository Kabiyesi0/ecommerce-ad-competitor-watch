import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import Anthropic from "@anthropic-ai/sdk";
import { sampleSite } from "./fetch-site.js";
import { classifyStore } from "./classify-store.js";
import { searchCandidates } from "./search-candidates.js";
import { pickCompetitors } from "./find-competitors.js";
import { fetchNewProducts } from "./products-shopify.js";
import { fetchAdsForCompetitorsParallel } from "./ads.js";
import { buildFindings, suggestAndCheckMoves } from "./compare-suggest-moves.js";
import { CostLog } from "./cost-log.js";
import {
  CostGuard,
  GLOBAL_MAX_RUN_COST_USD,
  GLOBAL_MAX_DAILY_COST_USD,
} from "../../src/lib/cost-guard.js";
import { createAllModelClients } from "../../src/llm/create-clients.js";
import { assertAiModeEnabled } from "../../src/lib/ai-mode.js";
import { normalizeDomain } from "./domain-utils.js";
import { REPO_ROOT } from "./repo-root.js";
import type { Candidate, Finding, Move, ProductsResult, AdsResult } from "./schema.js";

/** Report copy must read as plain English with no em dashes — models use them often. */
function noEmDash(text: string): string {
  return text.replace(/\s*—\s*/g, ". ").replace(/\s*–\s*/g, ", ");
}

/** The owner's own brand name, read from their homepage — so moves can be checked for addressing them by store name instead of "you". */
function extractOwnBrandName(homepageHtml: string): string | null {
  const $ = cheerio.load(homepageHtml);
  const title =
    $("meta[property='og:site_name']").attr("content") ??
    $("meta[property='og:title']").attr("content") ??
    $("title").first().text();
  if (!title?.trim()) return null;
  return title.replace(/\s*[|\-–].*$/, "").trim() || null;
}

const OUT_DIR = path.join(REPO_ROOT, "spike-results/report-fixtures");
const FIXTURES_DEST_DIR = path.join(REPO_ROOT, "app-prototype/fixtures");
const SCREENSHOTS_DEST_DIR = path.join(REPO_ROOT, "app-prototype/public/ads");
const COST_LOG_PATH = path.join(REPO_ROOT, "spike-results/cost-log.csv");
const DAILY_SPEND_PATH = path.join(REPO_ROOT, "spike-results/daily-spend.json");

export interface CompetitorFixture {
  domain: string;
  name: string;
  whyPicked: string;
  adsStatus: "ok" | "not_enough_data";
  adsReason?: string;
  totalAdsFound: number;
  topAds: Array<{
    libraryId: string;
    adText: string;
    hook: string | null;
    hasMultipleVersions: boolean;
    creativeVariantCount: number | null;
    adUrl: string;
    startDate: string | null;
    daysRunning: number | null;
    probablyPerforming: boolean;
    explanation: string | null;
    screenshotUrl: string | null;
  }>;
  productsStatus: "ok" | "not_enough_data";
  productsReason?: string;
  newProducts: Array<{ title: string; url: string; publishedAt: string | null }>;
  productsSourceUrl: string;
  productsCapturedAt: string;
}

export interface MoveFixture {
  competitorObservation: string;
  suggestion: string;
  citedCompetitorDomains: string[];
  sources: Array<{
    findingId: string;
    competitorDomain: string;
    brandName: string;
    kind: "product" | "ad";
    url: string | null;
    date: string | null;
  }>;
}

export interface ReportFixture {
  storeUrl: string;
  domain: string;
  capturedAt: string;
  ownProductsStatus: "ok" | "not_enough_data";
  competitors: CompetitorFixture[];
  moves: MoveFixture[];
  movesDiagnostics: {
    groundedCount: number;
    totalCount: number;
    distinctCompetitorsCited: number;
    diversityOk: boolean;
  };
  summary: {
    activeAdsFound: number;
    longestRunningAdDays: number | null;
    newProductsLast30Days: number;
  };
}

function copyScreenshot(
  domain: string,
  libraryId: string,
  localPath: string | null,
): string | null {
  if (!localPath || !existsSync(localPath)) return null;
  const destDir = `${SCREENSHOTS_DEST_DIR}/${domain.replace(/[^a-z0-9.-]/gi, "_")}`;
  mkdirSync(destDir, { recursive: true });
  const destPath = `${destDir}/${libraryId}.png`;
  copyFileSync(localPath, destPath);
  return `/ads/${domain.replace(/[^a-z0-9.-]/gi, "_")}/${libraryId}.png`;
}

export interface BuildReportResult {
  fixture: ReportFixture;
  costUsd: number;
  durationMs: number;
}

/**
 * Runs the real pipeline end to end for one store: classify -> search ->
 * pick -> products+ads (parallel) -> moves. Shared by the CLI
 * (generate-report-fixture.ts, which also persists the result to disk)
 * and the live-mode API route (which does not — it serves the fixture
 * straight to the browser for that one request).
 */
export async function buildReportFixture(storeUrl: string): Promise<BuildReportResult> {
  // See docs/decisions/007-free-mode.md — this is the AI pipeline (build-free-report.ts is the free one).
  assertAiModeEnabled("buildReportFixture");
  const runStart = performance.now();
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — check .env.local");
  }
  const anthropicRawClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const clients = createAllModelClients();
  const client = clients.claude;

  const costLog = new CostLog(COST_LOG_PATH);
  const costGuard = new CostGuard(
    GLOBAL_MAX_RUN_COST_USD,
    GLOBAL_MAX_DAILY_COST_USD,
    DAILY_SPEND_PATH,
  );
  const domain = new URL(storeUrl).hostname.replace(/\./g, "-");

  const ownSite = await sampleSite(storeUrl);
  const ownBrandName = extractOwnBrandName(ownSite.homepage.html);

  costGuard.checkBeforeCall(0.01);
  const classifyResult = await classifyStore(storeUrl, ownSite.combinedText, client, costLog);
  costGuard.recordActualSpend(costLog.rows.at(-1)?.costUsd ?? 0);
  const profile = classifyResult.profile;

  const ownProducts = await fetchNewProducts(storeUrl).catch(
    () =>
      ({
        status: "not_enough_data",
        reason: "fetch_error",
        dateBasis: "none",
        products: [],
        sourceUrl: storeUrl,
        capturedAt: new Date().toISOString(),
      }) as ProductsResult,
  );

  let candidates: Candidate[] = [];
  let candidateDomains: string[] = [];
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

    candidateDomains = candidatesText
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
  }

  const productsByDomain = new Map<string, ProductsResult>();
  await Promise.all(
    candidates.map(async (competitor) => {
      const competitorUrl = `https://${competitor.domain}`;
      const products = await fetchNewProducts(competitorUrl).catch(
        () =>
          ({
            status: "not_enough_data",
            reason: "fetch_error",
            dateBasis: "none",
            products: [],
            sourceUrl: competitorUrl,
            capturedAt: new Date().toISOString(),
          }) as ProductsResult,
      );
      productsByDomain.set(competitor.domain, products);
    }),
  );
  const adsByDomain = await fetchAdsForCompetitorsParallel(
    candidates.map((c) => ({ domain: c.domain, markets: profile?.markets ?? [] })),
  );
  const perCompetitor: Array<{ competitor: Candidate; products: ProductsResult; ads: AdsResult }> =
    candidates.map((competitor) => ({
      competitor,
      products: productsByDomain.get(competitor.domain)!,
      ads: adsByDomain.get(competitor.domain)!,
    }));

  const findings: Finding[] = buildFindings(perCompetitor);
  costGuard.checkBeforeCall(0.01);
  const movesResult = await suggestAndCheckMoves(
    storeUrl,
    findings,
    candidates,
    client,
    costLog,
    ownBrandName,
  );
  costGuard.recordActualSpend(costLog.rows.at(-1)?.costUsd ?? 0);

  const findingsById = new Map(findings.map((f) => [f.id, f]));
  const nameByDomain = new Map(candidates.map((c) => [normalizeDomain(c.domain), c.name]));
  const moveFixtures: MoveFixture[] = movesResult.moves.map((m: Move) => {
    const sources = m.citedFindingIds
      .map((id) => findingsById.get(id.trim().replace(/^\[+/, "").replace(/\]+$/, "")))
      .filter((f): f is Finding => f !== undefined)
      .map((f) => ({
        findingId: f.id,
        competitorDomain: f.competitorDomain,
        brandName: nameByDomain.get(normalizeDomain(f.competitorDomain)) ?? f.competitorDomain,
        kind: f.kind,
        url: f.url,
        date: f.date,
      }));
    return {
      competitorObservation: noEmDash(m.competitorObservation),
      suggestion: noEmDash(m.suggestion),
      citedCompetitorDomains: [...new Set(sources.map((s) => normalizeDomain(s.competitorDomain)))],
      sources,
    };
  });

  const competitorFixtures: CompetitorFixture[] = perCompetitor.map(
    ({ competitor, products, ads }) => {
      const topAds = ads.ads.map((ad) => ({
        libraryId: ad.libraryId,
        adText: noEmDash(ad.adText),
        hook: ad.hook ? noEmDash(ad.hook) : null,
        hasMultipleVersions: ad.hasMultipleVersions,
        creativeVariantCount: ad.creativeVariantCount,
        adUrl: ad.adUrl,
        startDate: ad.startDate,
        daysRunning: ad.daysRunning,
        probablyPerforming: ad.probablyPerforming,
        explanation: ad.explanation,
        screenshotUrl: copyScreenshot(competitor.domain, ad.libraryId, ad.screenshotPath),
      }));
      return {
        domain: competitor.domain,
        name: competitor.name,
        whyPicked: noEmDash(competitor.whyPicked),
        adsStatus: ads.status,
        adsReason: ads.reason,
        totalAdsFound: ads.totalAdsFound,
        topAds,
        productsStatus: products.status,
        productsReason: products.reason,
        newProducts: products.products.map((p) => ({
          title: p.title,
          url: p.url,
          publishedAt: p.publishedAt,
        })),
        productsSourceUrl: products.sourceUrl,
        productsCapturedAt: products.capturedAt,
      };
    },
  );

  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const newProductsLast30Days = competitorFixtures.reduce(
    (sum, c) =>
      sum +
      c.newProducts.filter(
        (p) => p.publishedAt && new Date(p.publishedAt).getTime() >= thirtyDaysAgo,
      ).length,
    0,
  );
  const allDaysRunning = competitorFixtures
    .flatMap((c) => c.topAds.map((a) => a.daysRunning))
    .filter((d): d is number => d !== null);

  const fixture: ReportFixture = {
    storeUrl,
    domain,
    capturedAt: new Date().toISOString(),
    ownProductsStatus: ownProducts.status,
    competitors: competitorFixtures,
    moves: moveFixtures,
    movesDiagnostics: {
      groundedCount: movesResult.groundedCount,
      totalCount: movesResult.totalCount,
      distinctCompetitorsCited: movesResult.distinctCompetitorsCited,
      diversityOk: movesResult.diversityOk,
    },
    summary: {
      activeAdsFound: competitorFixtures.reduce((sum, c) => sum + c.totalAdsFound, 0),
      longestRunningAdDays: allDaysRunning.length > 0 ? Math.max(...allDaysRunning) : null,
      newProductsLast30Days,
    },
  };

  return {
    fixture,
    costUsd: costGuard.runTotalSoFarUsd(),
    durationMs: performance.now() - runStart,
  };
}

/** Writes a built fixture to both the spike-results archive and the app's static fixtures dir — used by the CLI, not the live API route. */
export function writeReportFixture(fixture: ReportFixture): void {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(FIXTURES_DEST_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}/${fixture.domain}.json`, JSON.stringify(fixture, null, 2));
  writeFileSync(`${FIXTURES_DEST_DIR}/${fixture.domain}.json`, JSON.stringify(fixture, null, 2));
}
