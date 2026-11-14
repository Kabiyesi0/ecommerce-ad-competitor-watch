import { writeFileSync } from "node:fs";
import { fetchAdsViaHeadlessRead, closeAdLibraryBrowser } from "./ads.js";

const MIN_GAP_MS = 5000;
const MAX_GAP_MS = 10000;

function bucketReason(reason: string | undefined): string {
  if (!reason) return "ok";
  if (reason === "no_facebook_link_found_on_competitor_site") return "no FB link";
  if (
    reason === "no_search_result_page_matched_the_footer_link" ||
    reason === "page_not_matched" ||
    reason === "no_instagram_or_brand_name_match"
  ) {
    // An identity (Facebook/Instagram/brand name) WAS found on the site —
    // the Ad Library search just never returned a verified match for it.
    // That's a match failure, not an absent-link case, so it belongs here.
    return "no page match";
  }
  if (reason === "zero_search_results") return "zero results";
  if (
    reason === "unexpected_page_content_possible_block_or_wall" ||
    reason === "login_or_consent_wall" ||
    reason === "captcha_required"
  ) {
    return "unexpected page content";
  }
  if (reason.startsWith("tab_timeout") || reason === "overall_run_timeout_after_120s")
    return "timeout";
  if (reason === "zero_ad_cards_found_for_matched_page")
    return "zero results (matched page, no cards)";
  return `other: ${reason}`;
}

async function main() {
  const domains = process.argv.slice(2);
  if (domains.length === 0) {
    throw new Error("Usage: npm run measure-ad-hit-rate -- domain1.com domain2.com ...");
  }

  interface Row {
    domain: string;
    status: string;
    reason?: string;
    totalAdsFound: number;
    wallScreenshotPath?: string;
    bucket: string;
    durationMs: number;
  }

  const rows: Row[] = [];
  for (let i = 0; i < domains.length; i++) {
    const domain = domains[i]!;
    console.log(`[${i + 1}/${domains.length}] Checking ${domain} ...`);
    const start = performance.now();
    const result = await fetchAdsViaHeadlessRead(domain);
    const durationMs = Math.round(performance.now() - start);
    const bucket = result.status === "ok" ? "ok" : bucketReason(result.reason);
    rows.push({
      domain,
      status: result.status,
      reason: result.reason,
      totalAdsFound: result.totalAdsFound,
      wallScreenshotPath: result.wallScreenshotPath,
      bucket,
      durationMs,
    });
    console.log(
      `  -> ${bucket} (${durationMs}ms)${result.wallScreenshotPath ? ` — screenshot: ${result.wallScreenshotPath}` : ""}`,
    );

    if (i < domains.length - 1) {
      const gapMs = MIN_GAP_MS + Math.random() * (MAX_GAP_MS - MIN_GAP_MS);
      console.log(`  waiting ${Math.round(gapMs)}ms before the next competitor ...`);
      await new Promise((resolve) => setTimeout(resolve, gapMs));
    }
  }
  await closeAdLibraryBrowser();

  const hits = rows.filter((r) => r.status === "ok").length;
  const hitRate = ((hits / rows.length) * 100).toFixed(1);

  console.log("\n| Domain | Status | Bucket | Ads found | Duration |");
  console.log("|---|---|---|---|---|");
  for (const r of rows) {
    console.log(
      `| ${r.domain} | ${r.status} | ${r.bucket} | ${r.totalAdsFound} | ${r.durationMs}ms |`,
    );
  }

  console.log(`\n## Hit rate: ${hits}/${rows.length} (${hitRate}%)\n`);

  const bucketCounts = new Map<string, number>();
  for (const r of rows) {
    bucketCounts.set(r.bucket, (bucketCounts.get(r.bucket) ?? 0) + 1);
  }
  console.log("## Count per failure bucket\n");
  for (const [bucket, count] of [...bucketCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`- ${bucket}: ${count}`);
  }

  const screenshots = rows.filter((r) => r.wallScreenshotPath);
  if (screenshots.length > 0) {
    console.log("\n## Wall screenshots saved\n");
    for (const r of screenshots) {
      console.log(`- ${r.domain} (${r.reason}): ${r.wallScreenshotPath}`);
    }
  }

  writeFileSync(
    "spike-results/ad-hit-rate-measurement.json",
    JSON.stringify({ rows, hits, total: rows.length, hitRate }, null, 2),
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeAdLibraryBrowser();
    process.exit(process.exitCode ?? 0);
  });
