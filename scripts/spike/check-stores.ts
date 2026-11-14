import { safeFetch } from "../../src/lib/safe-fetch.js";
import { getRobotsRules, isDisallowed, USER_AGENT } from "./fetch-site.js";
import { fetchAdsViaHeadlessRead } from "./ads.js";

/**
 * Pure feasibility checks for Phase 0 — NO model calls, so this costs
 * nothing beyond the few free HTTP/headless-browser requests involved.
 * Checks, per store:
 *   1. Shopify /products.json reachable and shaped as expected
 *   2. robots.txt disallows the paths we'd actually need ("/" or "/products.json")
 *   3. Meta Ad Library (headless public-page read) shows active ads
 */

type YesNo = "yes" | "no";
type YesNoUnknown = "yes" | "no" | "couldn't check";

interface StoreCheck {
  store: string;
  productsJson: YesNo;
  robotsBlocksUs: YesNo;
  adLibraryActiveAds: YesNoUnknown;
  adLibraryReason?: string;
}

async function checkProductsJson(origin: string): Promise<YesNo> {
  try {
    const result = await safeFetch(new URL("/products.json", origin).toString(), {
      userAgent: USER_AGENT,
    });
    if (result.status !== 200) return "no";
    const parsed = JSON.parse(result.html) as { products?: unknown[] };
    return Array.isArray(parsed.products) ? "yes" : "no";
  } catch {
    return "no";
  }
}

async function checkRobotsBlocksUs(origin: string): Promise<YesNo> {
  const rules = await getRobotsRules(origin);
  // "Blocks us" = the paths we'd actually need to read are disallowed —
  // the homepage itself, or the Shopify products feed specifically.
  const blocksHomepage = isDisallowed("/", rules);
  const blocksProductsJson = isDisallowed("/products.json", rules);
  return blocksHomepage || blocksProductsJson ? "yes" : "no";
}

async function checkAdLibrary(domain: string): Promise<{ status: YesNoUnknown; reason?: string }> {
  const result = await fetchAdsViaHeadlessRead(domain);
  if (result.status === "ok") return { status: "yes" };
  // "no_ad_cards_found_in_rendered_page" means the page loaded and the
  // (unverified, best-effort) selector found nothing — that could mean
  // genuinely no active ads, or that the selector/page didn't render
  // what we expect. Not confident enough to call it a clean "no" either
  // way, so this is reported as "couldn't check" rather than guessed —
  // per the project's "not enough data is acceptable, never fabricate"
  // rule. Every reason gets reported in the second table so this isn't
  // silently hidden.
  return { status: "couldn't check", reason: result.reason };
}

async function main() {
  const stores = process.argv.slice(2);
  if (stores.length === 0) {
    throw new Error("Usage: npm run check-stores -- domain1.com domain2.com ...");
  }

  const results: StoreCheck[] = [];
  for (const store of stores) {
    const origin = store.startsWith("http") ? new URL(store).origin : `https://${store}`;
    console.error(`Checking ${store} ...`);

    const productsJson = await checkProductsJson(origin);
    const robotsBlocksUs = await checkRobotsBlocksUs(origin);
    const adLibrary = await checkAdLibrary(new URL(origin).hostname);

    results.push({
      store,
      productsJson,
      robotsBlocksUs,
      adLibraryActiveAds: adLibrary.status,
      adLibraryReason: adLibrary.reason,
    });
  }

  console.log(
    "\n| Store | Shopify /products.json | robots.txt blocks us | Meta Ad Library active ads |",
  );
  console.log(
    "|-------|-------------------------|------------------------|------------------------------|",
  );
  for (const r of results) {
    console.log(
      `| ${r.store} | ${r.productsJson} | ${r.robotsBlocksUs} | ${r.adLibraryActiveAds} |`,
    );
  }

  const withReasons = results.filter((r) => r.adLibraryReason);
  if (withReasons.length > 0) {
    console.log(
      '\nAd Library "couldn\'t check" reasons (unverified headless selector, per DATA_SOURCES.md):',
    );
    for (const r of withReasons) {
      console.log(`- ${r.store}: ${r.adLibraryReason}`);
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
