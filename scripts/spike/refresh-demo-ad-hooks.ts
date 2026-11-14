// One-off maintenance script: re-reads ads for every competitor domain
// already baked into the 5 demo fixtures, and patches topAds in both
// app-prototype/fixtures/*.json (AI-mode demos) and
// app-prototype/fixtures-free/*.json (free-mode demos) with the new
// hook/hasMultipleVersions/creativeVariantCount fields. No AI calls -
// ads.ts has no AI dependency. Run once after adding those fields to
// ads.ts's extraction logic, so the existing demo fixtures (captured
// before those fields existed) actually show real data instead of
// null/false for every ad.
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fetchAdsForCompetitorsParallel, closeAdLibraryBrowser } from "./ads.js";
import { REPO_ROOT } from "./repo-root.js";
import type { AdsResult } from "./schema.js";

const FIXTURES_DIR = path.join(REPO_ROOT, "app-prototype/fixtures");
const FIXTURES_FREE_DIR = path.join(REPO_ROOT, "app-prototype/fixtures-free");
const SCREENSHOTS_DEST_DIR = path.join(REPO_ROOT, "app-prototype/public/ads");

function copyScreenshotToPublic(
  domain: string,
  libraryId: string,
  localPath: string | null,
): string | null {
  if (!localPath || !existsSync(localPath)) return null;
  const safeDomain = domain.replace(/[^a-z0-9.-]/gi, "_");
  const destDir = `${SCREENSHOTS_DEST_DIR}/${safeDomain}`;
  mkdirSync(destDir, { recursive: true });
  const destPath = `${destDir}/${libraryId}.png`;
  copyFileSync(localPath, destPath);
  return `/ads/${safeDomain}/${libraryId}.png`;
}

function screenshotAsDataUrl(localPath: string | null): string | null {
  if (!localPath || !existsSync(localPath)) return null;
  return `data:image/png;base64,${readFileSync(localPath).toString("base64")}`;
}

async function main() {
  const fixtureFiles = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json"));
  const domains = new Set<string>();
  for (const file of fixtureFiles) {
    const fixture = JSON.parse(readFileSync(path.join(FIXTURES_DIR, file), "utf-8"));
    for (const c of fixture.competitors) domains.add(c.domain);
  }

  console.log(
    `Re-reading ads for ${domains.size} competitor domain(s): ${[...domains].join(", ")}`,
  );
  const adsByDomain = await fetchAdsForCompetitorsParallel(
    [...domains].map((domain) => ({ domain, markets: [] })),
  );
  await closeAdLibraryBrowser();

  for (const file of fixtureFiles) {
    for (const [dir, screenshotMode] of [
      [FIXTURES_DIR, "public"],
      [FIXTURES_FREE_DIR, "dataUrl"],
    ] as const) {
      const filePath = path.join(dir, file);
      if (!existsSync(filePath)) continue;
      const fixture = JSON.parse(readFileSync(filePath, "utf-8"));

      for (const competitor of fixture.competitors) {
        const ads: AdsResult | undefined = adsByDomain.get(competitor.domain);
        if (!ads || ads.status !== "ok") continue; // keep the existing data if the fresh read didn't improve on it

        competitor.adsStatus = ads.status;
        competitor.adsReason = ads.reason;
        competitor.totalAdsFound = ads.totalAdsFound;
        competitor.topAds = ads.ads.map((ad) => ({
          libraryId: ad.libraryId,
          adText: ad.adText,
          hook: ad.hook,
          hasMultipleVersions: ad.hasMultipleVersions,
          creativeVariantCount: ad.creativeVariantCount,
          adUrl: ad.adUrl,
          startDate: ad.startDate,
          daysRunning: ad.daysRunning,
          probablyPerforming: ad.probablyPerforming,
          explanation: ad.explanation,
          screenshotUrl:
            screenshotMode === "public"
              ? copyScreenshotToPublic(competitor.domain, ad.libraryId, ad.screenshotPath)
              : screenshotAsDataUrl(ad.screenshotPath),
        }));
      }

      const allDaysRunning = fixture.competitors
        .flatMap((c: { topAds: Array<{ daysRunning: number | null }> }) =>
          c.topAds.map((a) => a.daysRunning),
        )
        .filter((d: number | null): d is number => d !== null);
      fixture.summary.activeAdsFound = fixture.competitors.reduce(
        (sum: number, c: { totalAdsFound: number }) => sum + c.totalAdsFound,
        0,
      );
      fixture.summary.longestRunningAdDays =
        allDaysRunning.length > 0 ? Math.max(...allDaysRunning) : null;

      writeFileSync(filePath, JSON.stringify(fixture, null, 2));
      console.log(`updated ${filePath}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
