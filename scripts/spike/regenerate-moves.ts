/**
 * Regenerates just the `moves` section of existing report fixtures, by
 * reconstructing Finding[] from the fixture's own competitors (topAds +
 * newProducts) instead of re-running Shopify/Ad Library reads. Use this
 * when only the moves prompt/grounding logic changed, not the
 * underlying competitor/ad/product data.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import * as cheerio from "cheerio";
import { sampleSite } from "./fetch-site.js";
import { suggestAndCheckMoves } from "./compare-suggest-moves.js";
import { CostLog } from "./cost-log.js";
import { createAllModelClients } from "../../src/llm/create-clients.js";
import { normalizeDomain } from "./domain-utils.js";
import type { Candidate, Finding } from "./schema.js";

const FIXTURES_DEST_DIR = "app-prototype/fixtures";

function noEmDash(text: string): string {
  return text.replace(/\s*—\s*/g, ". ").replace(/\s*–\s*/g, ", ");
}

function extractOwnBrandName(homepageHtml: string): string | null {
  const $ = cheerio.load(homepageHtml);
  const title =
    $("meta[property='og:site_name']").attr("content") ??
    $("meta[property='og:title']").attr("content") ??
    $("title").first().text();
  if (!title?.trim()) return null;
  return title.replace(/\s*[|\-–].*$/, "").trim() || null;
}

interface FixtureCompetitor {
  domain: string;
  name: string;
  whyPicked: string;
  topAds: Array<{ libraryId: string; adText: string; adUrl: string; startDate: string | null }>;
  newProducts: Array<{ title: string; url: string; publishedAt: string | null }>;
}

function buildFindingsFromFixture(competitors: FixtureCompetitor[]): Finding[] {
  const findings: Finding[] = [];
  for (const c of competitors) {
    c.newProducts.forEach((p, i) => {
      findings.push({
        id: `${c.domain}-product-${i}`,
        competitorDomain: c.domain,
        kind: "product",
        summary: `${c.domain} launched "${p.title}"${p.publishedAt ? ` (published ${p.publishedAt})` : ""}`,
        url: p.url,
        date: p.publishedAt,
      });
    });
    c.topAds.forEach((ad, i) => {
      findings.push({
        id: `${c.domain}-ad-${i}`,
        competitorDomain: c.domain,
        kind: "ad",
        summary: `${c.domain} has an ad running: "${ad.adText.slice(0, 100)}"`,
        url: ad.adUrl,
        date: ad.startDate,
      });
    });
  }
  return findings;
}

async function main() {
  const domains = process.argv.slice(2);
  if (domains.length === 0) {
    throw new Error("Usage: npm run regenerate-moves -- siennanaturals-com shefit-com ...");
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — check .env.local");
  }
  const client = createAllModelClients().claude;
  const costLog = new CostLog("spike-results/cost-log.csv");

  for (const domainKey of domains) {
    const fixturePath = `${FIXTURES_DEST_DIR}/${domainKey}.json`;
    if (!existsSync(fixturePath)) {
      console.warn(`skip ${domainKey}: ${fixturePath} does not exist`);
      continue;
    }
    const fixture = JSON.parse(readFileSync(fixturePath, "utf-8"));
    console.log(`[${domainKey}] reading own site for brand name ...`);
    const ownSite = await sampleSite(fixture.storeUrl);
    const ownBrandName = extractOwnBrandName(ownSite.homepage.html);
    console.log(`[${domainKey}] own brand name: ${ownBrandName ?? "(none found)"}`);

    const candidates: Candidate[] = fixture.competitors.map((c: FixtureCompetitor) => ({
      domain: c.domain,
      name: c.name,
      whyPicked: c.whyPicked,
    }));
    const findings = buildFindingsFromFixture(fixture.competitors);

    const movesResult = await suggestAndCheckMoves(
      fixture.storeUrl,
      findings,
      candidates,
      client,
      costLog,
      ownBrandName,
    );

    const findingsById = new Map(findings.map((f) => [f.id, f]));
    const nameByDomain = new Map(candidates.map((c) => [normalizeDomain(c.domain), c.name]));
    const moves = movesResult.moves.map((m) => {
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
        citedCompetitorDomains: [
          ...new Set(sources.map((s) => normalizeDomain(s.competitorDomain))),
        ],
        sources,
      };
    });

    fixture.moves = moves;
    fixture.movesDiagnostics = {
      groundedCount: movesResult.groundedCount,
      totalCount: movesResult.totalCount,
      distinctCompetitorsCited: movesResult.distinctCompetitorsCited,
      diversityOk: movesResult.diversityOk,
    };

    writeFileSync(fixturePath, JSON.stringify(fixture, null, 2));
    writeFileSync(
      `spike-results/report-fixtures/${domainKey}.json`,
      JSON.stringify(fixture, null, 2),
    );
    console.log(
      `[${domainKey}] moves regenerated: ${movesResult.groundedCount}/${movesResult.totalCount} grounded`,
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
