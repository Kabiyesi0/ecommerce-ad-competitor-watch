import { fetchAdsViaHeadlessRead, closeAdLibraryBrowser } from "./ads.js";

interface Row {
  domain: string;
  facebookLinkFound: boolean;
  facebookPageUrl: string | null;
  pageMatched: boolean;
  adsFound: number;
  reason?: string;
  top3: Array<{
    libraryId: string;
    daysRunning: number | null;
    adUrl: string;
    startDate: string | null;
  }>;
}

async function main() {
  const domains = process.argv.slice(2);
  if (domains.length === 0) {
    throw new Error("Usage: npm run check-ad-library -- domain1.com domain2.com ...");
  }

  const rows: Row[] = [];
  for (const domain of domains) {
    console.error(`Checking ${domain} ...`);
    const result = await fetchAdsViaHeadlessRead(domain);
    const sorted = [...result.ads].sort((a, b) => (b.daysRunning ?? -1) - (a.daysRunning ?? -1));
    rows.push({
      domain,
      facebookLinkFound: result.facebookPageUrl !== null,
      facebookPageUrl: result.facebookPageUrl,
      pageMatched: result.facebookPageMatched,
      adsFound: result.totalAdsFound,
      reason: result.reason,
      top3: sorted.slice(0, 3).map((a) => ({
        libraryId: a.libraryId,
        daysRunning: a.daysRunning,
        adUrl: a.adUrl,
        startDate: a.startDate,
      })),
    });
  }
  await closeAdLibraryBrowser();

  console.log("\n| Domain | Facebook link found | Page matched | Ads found |");
  console.log("|--------|----------------------|--------------|-----------|");
  for (const r of rows) {
    console.log(
      `| ${r.domain} | ${r.facebookLinkFound ? "y" : "n"} | ${r.pageMatched ? "y" : "n"} | ${r.adsFound} |`,
    );
  }

  console.log("\n## Top 3 by days running, per competitor\n");
  for (const r of rows) {
    console.log(`### ${r.domain}`);
    if (r.facebookPageUrl) console.log(`Facebook page: ${r.facebookPageUrl}`);
    if (r.top3.length === 0) {
      console.log(`Not enough data${r.reason ? ` (${r.reason})` : ""}`);
    } else {
      for (const ad of r.top3) {
        console.log(
          `- ${ad.daysRunning ?? "?"} days running (started ${ad.startDate ?? "unknown"}) — ${ad.adUrl}`,
        );
      }
    }
    console.log("");
  }
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
