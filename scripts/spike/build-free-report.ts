import { readFileSync } from "node:fs";
import { sampleSite } from "./fetch-site.js";
import { fetchNewProducts } from "./products-shopify.js";
import { fetchAdsForCompetitorsParallel } from "./ads.js";
import { normalizeDomain } from "./domain-utils.js";
import type { ProductsResult, AdsResult } from "./schema.js";

// This file is the AI-free pipeline (see docs/decisions/007-free-mode.md):
// it never imports build-report.ts, classify-store.ts, search-candidates.ts,
// find-competitors.ts, compare-suggest-moves.ts, src/llm/*, or
// @anthropic-ai/sdk — so it cannot reach Claude regardless of AI_MODE.
// Keep it that way: don't add any of those imports here.

const MIN_COMPETITORS = 1;
const MAX_COMPETITORS = 3;

/** Report copy must read as plain English with no em dashes. */
function noEmDash(text: string): string {
  return text.replace(/\s*—\s*/g, ". ").replace(/\s*–\s*/g, ", ");
}

// Shapes match app-prototype/lib/types.ts's ReportFixture exactly, so the
// JSON this produces is a drop-in for the UI — kept as local copies here
// rather than imported from build-report.ts, so this file has no
// dependency (even a type-only one) on anything that touches Claude.
export interface FreeAdFixture {
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
}

export interface FreeCompetitorFixture {
  domain: string;
  name: string;
  /** Never shown in the UI — the owner typed this competitor in, so there is nothing to justify. Kept only for shape parity. */
  whyPicked: string;
  adsStatus: "ok" | "not_enough_data";
  adsReason?: string;
  totalAdsFound: number;
  topAds: FreeAdFixture[];
  productsStatus: "ok" | "not_enough_data";
  productsReason?: string;
  newProducts: Array<{ title: string; url: string; publishedAt: string | null }>;
  productsSourceUrl: string;
  productsCapturedAt: string;
}

export interface FreeReportFixture {
  storeUrl: string;
  domain: string;
  capturedAt: string;
  ownProductsStatus: "ok" | "not_enough_data";
  competitors: FreeCompetitorFixture[];
  moves: never[]; // free mode never writes moves — always empty
  movesDiagnostics: {
    groundedCount: 0;
    totalCount: 0;
    distinctCompetitorsCited: 0;
    diversityOk: false;
  };
  summary: {
    activeAdsFound: number;
    longestRunningAdDays: number | null;
    newProductsLast30Days: number;
  };
}

export interface BuildFreeReportResult {
  fixture: FreeReportFixture;
  durationMs: number;
}

/** Best-effort display name from a bare hostname, e.g. "gymshark.com" -> "Gymshark". No AI reasoning involved — this is cosmetic only. */
function labelFromDomain(domain: string): string {
  const base = domain.split(".")[0] ?? domain;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** Confirms a user-typed URL is safe-fetch-reachable (SSRF-checked, robots-respecting) and returns its normalized domain. Throws with a message naming the offending URL on failure — free mode fails the whole request rather than silently dropping a bad competitor. */
async function validateUrl(rawUrl: string): Promise<{ url: string; domain: string }> {
  const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
  let domain: string;
  try {
    domain = normalizeDomain(new URL(url).hostname);
  } catch {
    throw new Error(`"${rawUrl}" is not a valid web address.`);
  }
  try {
    await sampleSite(url, 0); // 0 linked pages — just prove the homepage is real and reachable
  } catch (err) {
    throw new Error(
      `Could not reach "${rawUrl}": ${err instanceof Error ? err.message : "unknown error"}`,
    );
  }
  return { url, domain };
}

/**
 * The free pipeline: validate the owner's URL and 1-3 competitor URLs,
 * then read each competitor's ads and new products directly — no
 * classify/search/pick step, no moves. Shared by the free-mode API route
 * and (indirectly, via the fixture-stripping script) the free demo set.
 */
export async function buildFreeReportFixture(
  storeUrl: string,
  competitorUrls: string[],
): Promise<BuildFreeReportResult> {
  const runStart = performance.now();

  if (competitorUrls.length < MIN_COMPETITORS || competitorUrls.length > MAX_COMPETITORS) {
    throw new Error(
      `Enter between ${MIN_COMPETITORS} and ${MAX_COMPETITORS} competitor web addresses.`,
    );
  }

  const store = await validateUrl(storeUrl);
  const competitors: Array<{ url: string; domain: string }> = [];
  const seenDomains = new Set<string>([store.domain]);
  for (const rawUrl of competitorUrls) {
    const competitor = await validateUrl(rawUrl);
    if (seenDomains.has(competitor.domain)) {
      throw new Error(
        `"${competitor.domain}" was entered more than once, or matches your own store.`,
      );
    }
    seenDomains.add(competitor.domain);
    competitors.push(competitor);
  }

  const ownProducts = await fetchNewProducts(store.url).catch(
    () =>
      ({
        status: "not_enough_data",
        reason: "fetch_error",
        dateBasis: "none",
        products: [],
        sourceUrl: store.url,
        capturedAt: new Date().toISOString(),
      }) as ProductsResult,
  );

  const productsByDomain = new Map<string, ProductsResult>();
  await Promise.all(
    competitors.map(async (c) => {
      const products = await fetchNewProducts(c.url).catch(
        () =>
          ({
            status: "not_enough_data",
            reason: "fetch_error",
            dateBasis: "none",
            products: [],
            sourceUrl: c.url,
            capturedAt: new Date().toISOString(),
          }) as ProductsResult,
      );
      productsByDomain.set(c.domain, products);
    }),
  );

  const adsByDomain = await fetchAdsForCompetitorsParallel(
    competitors.map((c) => ({ domain: c.domain, markets: [] })),
  );

  const competitorFixtures: FreeCompetitorFixture[] = competitors.map((c) => {
    const ads = adsByDomain.get(c.domain) as AdsResult;
    const products = productsByDomain.get(c.domain)!;
    const topAds: FreeAdFixture[] = ads.ads.map((ad) => ({
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
      // Screenshots go straight into the response, never to public/ads/ —
      // no new storage. ads.ts's own internal temp cache (unchanged) is
      // where this file comes from; read it once, encode it, done.
      screenshotUrl: ad.screenshotPath ? readScreenshotAsDataUrl(ad.screenshotPath) : null,
    }));
    return {
      domain: c.domain,
      name: labelFromDomain(c.domain),
      whyPicked: "You told us to check this one.",
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
  });

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

  const fixture: FreeReportFixture = {
    storeUrl: store.url,
    domain: store.domain.replace(/\./g, "-"),
    capturedAt: new Date().toISOString(),
    ownProductsStatus: ownProducts.status,
    competitors: competitorFixtures,
    moves: [],
    movesDiagnostics: {
      groundedCount: 0,
      totalCount: 0,
      distinctCompetitorsCited: 0,
      diversityOk: false,
    },
    summary: {
      activeAdsFound: competitorFixtures.reduce((sum, c) => sum + c.totalAdsFound, 0),
      longestRunningAdDays: allDaysRunning.length > 0 ? Math.max(...allDaysRunning) : null,
      newProductsLast30Days,
    },
  };

  return { fixture, durationMs: performance.now() - runStart };
}

function readScreenshotAsDataUrl(localPath: string): string | null {
  try {
    return `data:image/png;base64,${readFileSync(localPath).toString("base64")}`;
  } catch {
    return null;
  }
}
