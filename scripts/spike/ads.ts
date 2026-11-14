import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import sharp from "sharp";
import { chromium } from "playwright";
import { safeFetch } from "../../src/lib/safe-fetch.js";
import { USER_AGENT } from "./fetch-site.js";
import { REPO_ROOT } from "./repo-root.js";
import type { AdFinding, AdsResult } from "./schema.js";

const THUMBNAIL_MAX_WIDTH = 240;

const META_AD_LIBRARY_API_BASE = "https://graph.facebook.com/v19.0/ads_archive";

/**
 * Official Meta Ad Library API. Free, but requires a verified Meta
 * developer account and an access token (env: META_AD_LIBRARY_ACCESS_TOKEN
 * — a separate setup step from the Anthropic key, not evaluated yet).
 * Per DATA_SOURCES.md, this only covers EU/UK audiences for commercial
 * ads, so it's only tried for competitors plausibly targeting those
 * markets. It never returns spend/impressions for commercial ads — only
 * start date, which is used as the "days running" proxy.
 */
export async function fetchAdsViaOfficialApi(
  competitorDomain: string,
  competitorMarkets: string[],
): Promise<AdsResult> {
  const capturedAt = new Date().toISOString();
  const token = process.env.META_AD_LIBRARY_ACCESS_TOKEN;
  const targetsEuUk = competitorMarkets.some((m) =>
    ["eu", "european union", "uk", "united kingdom", "gb"].includes(m.toLowerCase()),
  );

  if (!token) {
    return {
      status: "not_enough_data",
      reason: "META_AD_LIBRARY_ACCESS_TOKEN not set — official API not evaluated this run",
      source: "none",
      facebookPageUrl: null,
      facebookPageMatched: false,
      resolvedPageId: null,
      totalAdsFound: 0,
      ads: [],
      sourceUrl: null,
      capturedAt,
    };
  }
  if (!targetsEuUk) {
    return {
      status: "not_enough_data",
      reason: "official_api_covers_eu_uk_audiences_only_and_this_store_does_not_target_them",
      source: "none",
      facebookPageUrl: null,
      facebookPageMatched: false,
      resolvedPageId: null,
      totalAdsFound: 0,
      ads: [],
      sourceUrl: null,
      capturedAt,
    };
  }

  const params = new URLSearchParams({
    access_token: token,
    ad_reached_countries: "['GB','EU']" as unknown as string,
    search_page_ids: "", // page id lookup for the domain is a separate step, not done in this spike
    ad_active_status: "ACTIVE",
  });
  const url = `${META_AD_LIBRARY_API_BASE}?${params.toString()}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return {
        status: "not_enough_data",
        reason: `official_api_http_${response.status}`,
        source: "meta_ad_library_api",
        facebookPageUrl: null,
        facebookPageMatched: false,
        resolvedPageId: null,
        totalAdsFound: 0,
        ads: [],
        sourceUrl: url,
        capturedAt,
      };
    }
    const body = (await response.json()) as { data?: Array<Record<string, unknown>> };
    const allAds: AdFinding[] = (body.data ?? []).map((raw) => {
      const startDate =
        typeof raw.ad_delivery_start_time === "string" ? raw.ad_delivery_start_time : null;
      const libraryId = typeof raw.id === "string" ? raw.id : "unknown";
      return {
        libraryId,
        adText:
          typeof raw.ad_creative_bodies === "object"
            ? JSON.stringify(raw.ad_creative_bodies)
            : "unknown",
        hook: null,
        hasMultipleVersions: false,
        creativeVariantCount: null,
        adUrl: `https://www.facebook.com/ads/library/?id=${libraryId}`,
        startDate,
        daysRunning: startDate
          ? Math.floor((Date.now() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24))
          : null,
        platform: "meta",
        probablyPerforming: false,
        explanation: null,
        screenshotPath: null,
      };
    });
    const ads = selectTopAds(allAds, TOP_N_PROBABLY_PERFORMING);

    return {
      status: ads.length > 0 ? "ok" : "not_enough_data",
      reason: ads.length > 0 ? undefined : "no_active_ads_returned",
      source: "meta_ad_library_api",
      facebookPageUrl: null,
      facebookPageMatched: false,
      resolvedPageId: null,
      totalAdsFound: allAds.length,
      ads,
      sourceUrl: url,
      capturedAt,
    };
  } catch (err) {
    return {
      status: "not_enough_data",
      reason: `official_api_error: ${err instanceof Error ? err.message : "unknown"}`,
      source: "meta_ad_library_api",
      facebookPageUrl: null,
      facebookPageMatched: false,
      resolvedPageId: null,
      totalAdsFound: 0,
      ads: [],
      sourceUrl: url,
      capturedAt,
    };
  }
}

// ---------------------------------------------------------------------------
// Headless read — rewritten per docs/decisions/002-ad-source-choice.md.
//
// The previous version searched the Ad Library by bare domain text, which
// is a keyword match, not an advertiser lookup — it returned ads from
// unrelated businesses that happen to share a word with the domain. This
// version instead:
//   1. Finds the competitor's own declared Facebook page link on their own
//      site (footer/contact/about) — recorded as the match's source.
//   2. Resolves that link to a specific numeric Facebook page id by
//      searching the Ad Library and matching candidate results' own
//      declared page link against the footer link — never a fuzzy guess.
//   3. Reads that page's OWN page-scoped Ad Library view
//      (view_all_page_id=<id>), so every card shown is confirmed to belong
//      to the right business.
//   4. Parses ad cards by their VISIBLE text ("Library ID:", "Started
//      running on"), not role attributes or CSS classes, which proved
//      unreliable before and change without notice.
// Any failure at any step (no link, no match, a login/consent wall, zero
// cards) returns "not enough data" — never a fallback to keyword search.
// ---------------------------------------------------------------------------

const CACHE_DIR = path.join(REPO_ROOT, "spike-results/ad-library-cache");
const SCREENSHOT_DIR = path.join(REPO_ROOT, "spike-results/ad-screenshots");
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_NAV_INTERVAL_MS = 2000; // politeness: space out Ad Library navigations
const TOP_N_PROBABLY_PERFORMING = 3;
const MAX_AD_CARDS = 50;

function cachePathFor(domain: string): string {
  mkdirSync(CACHE_DIR, { recursive: true });
  return `${CACHE_DIR}/${domain.replace(/[^a-z0-9.-]/gi, "_")}.json`;
}

function readCache(domain: string): AdsResult | null {
  const path = cachePathFor(domain);
  if (!existsSync(path)) return null;
  try {
    const cached = JSON.parse(readFileSync(path, "utf-8")) as AdsResult;
    const ageMs = Date.now() - new Date(cached.capturedAt).getTime();
    if (ageMs > CACHE_TTL_MS) return null;
    return cached;
  } catch {
    return null;
  }
}

function writeCache(domain: string, result: AdsResult): void {
  writeFileSync(cachePathFor(domain), JSON.stringify(result, null, 2));
}

const UNUSABLE_FACEBOOK_PATH =
  /\/(sharer|share\.php|share_channel|plugins|tr|dialog|login\.php|policies|privacy|help|business|watch|events|groups|pages\/category)\b/i;

/** facebook.com (any path, including the legacy /pages/ format) and fb.me short links. */
function isUsableFacebookLink(href: string): boolean {
  if (!/facebook\.com/i.test(href) && !/fb\.me/i.test(href)) return false;
  return !UNUSABLE_FACEBOOK_PATH.test(href);
}

/** fb.me is a redirect-only short-link host — resolve it to the real facebook.com URL it points to before extracting a slug, since the slug lives at the far end of the redirect, not in the fb.me link itself. */
async function resolveFacebookLink(href: string, origin: string): Promise<string> {
  const absolute = new URL(href, origin).toString();
  if (!/fb\.me/i.test(absolute)) return normalizeFacebookUrl(absolute);
  try {
    const result = await safeFetch(absolute, { userAgent: USER_AGENT });
    return normalizeFacebookUrl(result.finalUrl);
  } catch {
    return normalizeFacebookUrl(absolute);
  }
}

function normalizeFacebookUrl(href: string): string {
  try {
    const u = new URL(href, "https://www.facebook.com");
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return href;
  }
}

interface FacebookIdentity {
  slug: string | null;
  profileId: string | null;
}

function identifyFacebookUrl(rawUrl: string): FacebookIdentity {
  try {
    const u = new URL(rawUrl);
    const pathParts = u.pathname.split("/").filter(Boolean);
    const first = pathParts[0]?.toLowerCase();
    if (first === "profile.php") {
      return { slug: null, profileId: u.searchParams.get("id") };
    }
    return { slug: first ?? null, profileId: null };
  } catch {
    return { slug: null, profileId: null };
  }
}

function identitiesMatch(a: FacebookIdentity, b: FacebookIdentity): boolean {
  if (a.slug && b.slug) return a.slug === b.slug;
  if (a.profileId && b.profileId) return a.profileId === b.profileId;
  return false;
}

export interface SocialIdentity {
  facebookUrl: string | null;
  instagramHandle: string | null;
  siteBrandName: string | null;
}

/**
 * Checks the competitor's own site (home, then a few likely contact/about
 * paths) for a Facebook page link — recorded as the match's source, per
 * the project's "every claim shows its source" rule. Share/plugin/tracking
 * links are excluded so a share button doesn't get mistaken for the page.
 * Also collects an Instagram handle and the site's own brand name
 * (og:site_name/title) along the way, as a fallback identity when there's
 * no Facebook link at all.
 */
function extractFromHtml($: ReturnType<typeof cheerio.load>): {
  facebookHref: string | null;
  instagramHandle: string | null;
  siteBrandName: string | null;
} {
  let facebookHref: string | null = null;
  $("a[href*='facebook.com'], a[href*='fb.me']").each((_, el) => {
    if (facebookHref) return;
    const href = $(el).attr("href");
    if (href && isUsableFacebookLink(href)) facebookHref = href;
  });

  let instagramHandle: string | null = null;
  $("a[href*='instagram.com']").each((_, el) => {
    if (instagramHandle) return;
    const href = $(el).attr("href");
    const handle = href ? extractInstagramHandle(href) : null;
    if (handle) instagramHandle = handle;
  });

  const siteBrandName =
    $("meta[property='og:site_name']").attr("content") ??
    $("meta[property='og:title']").attr("content") ??
    $("title").first().text();

  return { facebookHref, instagramHandle, siteBrandName: siteBrandName?.trim() || null };
}

/**
 * Checks the competitor's own site (home, then a few likely contact/about
 * paths) for a Facebook page link — recorded as the match's source, per
 * the project's "every claim shows its source" rule. Share/plugin/tracking
 * links are excluded so a share button doesn't get mistaken for the page.
 * fb.me short links are resolved to their real facebook.com destination.
 * Also collects an Instagram handle and the site's own brand name
 * (og:site_name/title) along the way, as a fallback identity when there's
 * no Facebook link at all.
 *
 * Many storefronts render their footer's social links client-side (a
 * Shopify theme section, a third-party app embed), so a plain static
 * fetch of the HTML never sees them. If nothing is found across the
 * static pages, one more pass renders the homepage in a headless browser
 * (after JS has run) and re-checks there before giving up.
 */
export async function findSocialIdentity(domain: string): Promise<SocialIdentity> {
  const origin = `https://${domain}`;
  const pathsToCheck = [
    "/",
    "/pages/contact",
    "/pages/contact-us",
    "/contact",
    "/contact-us",
    "/pages/about-us",
    "/about",
  ];

  let facebookHref: string | null = null;
  let instagramHandle: string | null = null;
  let siteBrandName: string | null = null;

  for (const path of pathsToCheck) {
    try {
      const result = await safeFetch(new URL(path, origin).toString(), { userAgent: USER_AGENT });
      if (result.status === 200) {
        const found = extractFromHtml(cheerio.load(result.html));
        facebookHref ??= found.facebookHref;
        instagramHandle ??= found.instagramHandle;
        siteBrandName ??= found.siteBrandName;
      }
    } catch {
      // try the next candidate page
    }
    await new Promise((resolve) => setTimeout(resolve, 400)); // polite delay between our own checks
    if (facebookHref) break; // the strongest signal — no need to keep scanning once we have it
  }

  if (!facebookHref && !instagramHandle && !siteBrandName) {
    const rendered = await findSocialIdentityRendered(origin);
    facebookHref ??= rendered.facebookHref;
    instagramHandle ??= rendered.instagramHandle;
    siteBrandName ??= rendered.siteBrandName;
  }

  const facebookUrl = facebookHref ? await resolveFacebookLink(facebookHref, origin) : null;
  return { facebookUrl, instagramHandle, siteBrandName };
}

/**
 * Renders the homepage in the shared headless browser and re-checks it
 * for a Facebook/Instagram link or brand name after JS has run — the
 * fallback for themes/apps that inject the footer's social links
 * client-side, which a plain HTTP fetch of the static HTML never sees.
 */
async function findSocialIdentityRendered(origin: string): Promise<{
  facebookHref: string | null;
  instagramHandle: string | null;
  siteBrandName: string | null;
}> {
  let page: import("playwright").Page | null = null;
  try {
    const browser = await getSharedBrowser();
    page = await browser.newPage({ userAgent: USER_AGENT });
    await page.goto(origin, { waitUntil: "load", timeout: 15_000 });
    await page.waitForTimeout(1500); // let any client-side-rendered footer finish mounting
    const html = await page.content();
    return extractFromHtml(cheerio.load(html));
  } catch {
    return { facebookHref: null, instagramHandle: null, siteBrandName: null };
  } finally {
    await page?.close();
  }
}

/** Thin wrapper kept for check-ad-library.ts's reporting, which only needs the Facebook link. */
export async function findFacebookPageLink(domain: string): Promise<string | null> {
  return (await findSocialIdentity(domain)).facebookUrl;
}

let sharedBrowser: import("playwright").Browser | null = null;
let lastNavAt = 0;

async function getSharedBrowser(): Promise<import("playwright").Browser> {
  if (!sharedBrowser) {
    // A static import, not a dynamic import("playwright") — under
    // Next.js's dev server, a dynamic import of a serverExternalPackages
    // entry fails to resolve ("Cannot find module .../.next/dev/server/
    // package.json"), even though a static import of the same package
    // (see sharp above) works fine. This affects both the CLI and any
    // Next.js route that reaches this function.
    sharedBrowser = await chromium.launch({ headless: true });
  }
  return sharedBrowser;
}

/** Closes the one shared browser. Call once after a whole batch of competitors is done. */
export async function closeAdLibraryBrowser(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
}

type GotoFn = (page: import("playwright").Page, url: string) => Promise<void>;

/** Used for sequential, single-page reads (e.g. check-ad-library.ts's batch over many domains) — spaces out navigations so we don't hammer the Ad Library. */
async function politeGoto(page: import("playwright").Page, url: string): Promise<void> {
  const elapsed = Date.now() - lastNavAt;
  if (elapsed < MIN_NAV_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_NAV_INTERVAL_MS - elapsed));
  }
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
  lastNavAt = Date.now();
  await page.waitForTimeout(2500); // let client-side rendering settle
}

/** Used for parallel reads (one report's 3 competitors, each in their own tab) — no cross-tab throttle, since each tab is a separate page and there are only ever a few of them for one report. */
async function fastGoto(page: import("playwright").Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.waitForTimeout(1500);
}

interface ResolvedPage {
  pageId: string | null;
  matched: boolean;
  reason?: string;
  wallScreenshotPath?: string;
}

interface SearchCandidate {
  profileUri: string;
  name: string;
}

interface SearchOutcome {
  candidates: Map<string, SearchCandidate>;
  wallReason?: string;
  /** Local screenshot of what the page actually showed, saved whenever wallReason is set, so a human can see what we're fighting. */
  wallScreenshotPath?: string;
}

const WALL_SCREENSHOT_DIR = path.join(REPO_ROOT, "spike-results/wall-screenshots");

async function captureWallScreenshot(
  page: import("playwright").Page,
  label: string,
  reason: string,
): Promise<string | undefined> {
  try {
    mkdirSync(WALL_SCREENSHOT_DIR, { recursive: true });
    const safeLabel = label.replace(/[^a-z0-9.-]/gi, "_");
    const path = `${WALL_SCREENSHOT_DIR}/${safeLabel}-${reason}-${Date.now()}.png`;
    await page.screenshot({ path, fullPage: false });
    return path;
  } catch {
    return undefined;
  }
}

/** Fetches the competitor's own Facebook page and reads its display name (og:title), for the brand-name fallback search. */
async function fetchFacebookPageName(facebookPageUrl: string): Promise<string | null> {
  try {
    const result = await safeFetch(facebookPageUrl, { userAgent: USER_AGENT });
    if (result.status !== 200) return null;
    const $ = cheerio.load(result.html);
    const title = $("meta[property='og:title']").attr("content") ?? $("title").text();
    if (!title) return null;
    return title.replace(/\s*\|\s*Facebook$/i, "").trim() || null;
  } catch {
    return null;
  }
}

/**
 * Runs one Ad Library search and returns every candidate's own declared
 * page link/name, read out of the page's embedded result data
 * (page_id/page_profile_uri/page_name) — exact, not guessed from
 * rendered text (display names can be truncated/co-branded).
 */
async function loadSearchPage(
  page: import("playwright").Page,
  searchUrl: string,
  gotoFn: GotoFn,
): Promise<{ html: string; bodyText: string }> {
  await gotoFn(page, searchUrl);
  const html = await page.content();
  const bodyText = await page.innerText("body").catch(() => "");
  return { html, bodyText };
}

async function searchAdLibrary(
  page: import("playwright").Page,
  query: string,
  gotoFn: GotoFn,
  label: string,
): Promise<SearchOutcome> {
  const searchUrl = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&q=${encodeURIComponent(query)}&search_type=keyword_unordered`;
  let { html, bodyText } = await loadSearchPage(page, searchUrl, gotoFn);

  // The "ad library" text check occasionally misses on a page that just
  // hadn't finished rendering yet — a transient render-timing issue, not
  // a real block. Wait a beat and recheck the SAME load once; if that
  // still fails, reload fresh once before concluding it's a real wall.
  if (!/"xfb_ad_library_is_captcha_required":true/i.test(html) && !/ad library/i.test(bodyText)) {
    await page.waitForTimeout(2000);
    bodyText = await page.innerText("body").catch(() => "");
    if (!/ad library/i.test(bodyText)) {
      ({ html, bodyText } = await loadSearchPage(page, searchUrl, gotoFn));
    }
  }

  if (/"xfb_ad_library_is_captcha_required":true/i.test(html)) {
    const wallScreenshotPath = await captureWallScreenshot(page, label, "captcha_required");
    return { candidates: new Map(), wallReason: "captcha_required", wallScreenshotPath };
  }
  if (!/ad library/i.test(bodyText)) {
    const wallScreenshotPath = await captureWallScreenshot(
      page,
      label,
      "unexpected_page_content_possible_block_or_wall",
    );
    return {
      candidates: new Map(),
      wallReason: "unexpected_page_content_possible_block_or_wall",
      wallScreenshotPath,
    };
  }
  if (/you must log in|log in to continue|log in to see more/i.test(bodyText)) {
    const wallScreenshotPath = await captureWallScreenshot(page, label, "login_or_consent_wall");
    return { candidates: new Map(), wallReason: "login_or_consent_wall", wallScreenshotPath };
  }

  // Minified/flat JSON embedded in the page — page_id and
  // page_profile_uri reliably belong to the same entry (verified: this
  // pairing never drifted across repeated fetches during debugging), but
  // page_name is NOT used for the primary slug match (identitiesMatch
  // only reads profileUri) — it's read with a short, bounded lookahead
  // rather than an unbounded one, since an unbounded scan occasionally
  // picked up an unrelated neighboring entry's name.
  const entryPattern =
    /"page_id":"(\d+)"[^}]{0,120}?"page_profile_uri":"([^"]+)"(?:[^}]{0,120}?"page_name":"([^"]*)")?/g;
  const candidates = new Map<string, SearchCandidate>();
  for (const m of html.matchAll(entryPattern)) {
    const pageId = m[1];
    const profileUriRaw = m[2];
    if (!pageId || !profileUriRaw || candidates.has(pageId)) continue;
    candidates.set(pageId, { profileUri: profileUriRaw.replace(/\\\//g, "/"), name: m[3] ?? "" });
  }
  return { candidates };
}

function findMatch(
  candidates: Map<string, SearchCandidate>,
  identity: FacebookIdentity,
): string | null {
  for (const [pageId, info] of candidates) {
    if (identitiesMatch(identity, identifyFacebookUrl(info.profileUri))) return pageId;
  }
  return null;
}

/**
 * Resolves a Facebook page link to a numeric Ad Library page id. Tries
 * the page's own slug/id first, and ALWAYS also tries the page's own
 * display name (read from the page itself, not guessed) — even when the
 * slug search already returned some candidates, since the Ad Library's
 * anonymous keyword search is a loose relevance match, not a reliable
 * advertiser lookup: it can return a page under its display name but not
 * under its URL slug (or vice versa), so stopping after the first query
 * just because it returned *something* misses real matches. EITHER way,
 * a result is only accepted if its own declared page link matches the
 * footer link exactly. Never falls back to accepting an unmatched top
 * result.
 */
async function resolvePageId(
  page: import("playwright").Page,
  facebookPageUrl: string,
  gotoFn: GotoFn,
  label: string,
): Promise<ResolvedPage> {
  const identity = identifyFacebookUrl(facebookPageUrl);
  const slugQuery = identity.slug ?? identity.profileId;
  if (!slugQuery) {
    return { pageId: null, matched: false, reason: "facebook_link_could_not_be_parsed" };
  }

  const slugResult = await searchAdLibrary(page, slugQuery, gotoFn, label);
  if (slugResult.wallReason) {
    return {
      pageId: null,
      matched: false,
      reason: slugResult.wallReason,
      wallScreenshotPath: slugResult.wallScreenshotPath,
    };
  }
  const slugMatch = findMatch(slugResult.candidates, identity);
  if (slugMatch) return { pageId: slugMatch, matched: true };

  const brandName = await fetchFacebookPageName(facebookPageUrl);
  let anyResultsFound = slugResult.candidates.size > 0;
  if (brandName && brandName.toLowerCase() !== slugQuery.toLowerCase()) {
    const nameResult = await searchAdLibrary(page, brandName, gotoFn, label);
    if (nameResult.wallReason) {
      return {
        pageId: null,
        matched: false,
        reason: nameResult.wallReason,
        wallScreenshotPath: nameResult.wallScreenshotPath,
      };
    }
    const nameMatch = findMatch(nameResult.candidates, identity);
    if (nameMatch) return { pageId: nameMatch, matched: true };
    anyResultsFound ||= nameResult.candidates.size > 0;
  }

  return {
    pageId: null,
    matched: false,
    reason: anyResultsFound
      ? "no_search_result_page_matched_the_footer_link"
      : "zero_search_results",
  };
}

function normalizeBrandName(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** A brand's Instagram handle, extracted from a profile-style instagram.com link (not /p/, /reel/, etc.). */
function extractInstagramHandle(href: string): string | null {
  try {
    const u = new URL(href, "https://www.instagram.com");
    const parts = u.pathname.split("/").filter(Boolean);
    const first = parts[0]?.toLowerCase();
    if (!first || ["p", "reel", "reels", "explore", "accounts", "stories", "tv"].includes(first))
      return null;
    return first;
  } catch {
    return null;
  }
}

/**
 * Fallback path when the competitor's site has no Facebook link at all.
 * Tries the site's Instagram handle first (brands commonly reuse the
 * same handle on Facebook, so a candidate whose own Facebook slug
 * matches it is a real, verified identity match, not a guess), then the
 * site's own brand name (verified by an exact, normalized match against
 * the candidate's own declared page name — not just picking the top
 * result).
 */
async function resolveViaInstagramOrBrandName(
  page: import("playwright").Page,
  identity: { instagramHandle: string | null; siteBrandName: string | null },
  gotoFn: GotoFn,
  label: string,
): Promise<ResolvedPage> {
  if (identity.instagramHandle) {
    const result = await searchAdLibrary(page, identity.instagramHandle, gotoFn, label);
    if (result.wallReason) {
      return {
        pageId: null,
        matched: false,
        reason: result.wallReason,
        wallScreenshotPath: result.wallScreenshotPath,
      };
    }
    const targetIdentity: FacebookIdentity = {
      slug: identity.instagramHandle.toLowerCase(),
      profileId: null,
    };
    const match = findMatch(result.candidates, targetIdentity);
    if (match) return { pageId: match, matched: true };
  }

  if (identity.siteBrandName) {
    const result = await searchAdLibrary(page, identity.siteBrandName, gotoFn, label);
    if (result.wallReason) {
      return {
        pageId: null,
        matched: false,
        reason: result.wallReason,
        wallScreenshotPath: result.wallScreenshotPath,
      };
    }
    const normalizedTarget = normalizeBrandName(identity.siteBrandName);
    for (const [pageId, info] of result.candidates) {
      if (info.name && normalizeBrandName(info.name) === normalizedTarget) {
        return { pageId, matched: true };
      }
    }
  }

  return { pageId: null, matched: false, reason: "no_instagram_or_brand_name_match" };
}

interface RawAdCard {
  libraryId: string;
  startDateRaw: string;
  rawText: string;
}

// Runs in the browser. Passed to page.evaluate as a source string (not a
// typed function) so this file doesn't need the DOM lib added to the
// whole project's tsconfig just for this one call site.
const EXTRACT_AD_CARDS_SCRIPT = `
(() => {
  function countLib(el) {
    return (el.textContent.match(/Library ID:/g) || []).length;
  }
  const xpathResult = document.evaluate(
    "//text()[contains(., 'Library ID:')]",
    document,
    null,
    XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
    null,
  );
  const seen = new Set();
  const cards = [];
  for (let i = 0; i < xpathResult.snapshotLength; i++) {
    const textNode = xpathResult.snapshotItem(i);
    let node = textNode && textNode.parentElement;
    if (!node) continue;
    while (node.parentElement && countLib(node.parentElement) === 1) {
      node = node.parentElement;
    }
    if (!seen.has(node)) {
      seen.add(node);
      cards.push(node.textContent || "");
    }
  }
  return cards;
})()
`;

async function extractAdCards(page: import("playwright").Page): Promise<RawAdCard[]> {
  const rawTexts = (await page.evaluate(EXTRACT_AD_CARDS_SCRIPT)) as string[];
  const cards: RawAdCard[] = [];
  for (const text of rawTexts) {
    const idMatch = /Library ID:\s*(\d+)/.exec(text);
    const dateMatch = /Started running on\s*(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})/.exec(text);
    if (!idMatch?.[1] || !dateMatch?.[1]) continue;
    cards.push({ libraryId: idMatch[1], startDateRaw: dateMatch[1], rawText: text });
  }
  return cards;
}

/**
 * Scrolls the page-scoped view to load more cards until either the cap
 * is hit or one scroll loads nothing new, extracting cards after every
 * round and reporting them via `onProgress` — so a caller racing this
 * against a timeout still has the latest-known cards to fall back on
 * even if this function never returns.
 */
async function scrollAndCollectCards(
  page: import("playwright").Page,
  cap: number,
  onProgress?: (cards: RawAdCard[]) => void,
): Promise<RawAdCard[]> {
  let cards = (await extractAdCards(page)).slice(0, cap);
  onProgress?.(cards);
  while (cards.length < cap) {
    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
    await page.waitForTimeout(1200);
    const next = (await extractAdCards(page)).slice(0, cap);
    if (next.length <= cards.length) break; // stop at the first scroll that loads nothing new
    cards = next;
    onProgress?.(cards);
  }
  return cards;
}

/**
 * Finds the card element for a specific library id and, if it holds a
 * video, pauses it at its first frame and injects a visible play-icon
 * overlay before the caller screenshots it — so a saved video thumbnail
 * still reads as a video even though FB's own play control only shows on
 * hover. The id is validated as digits-only by the caller before this
 * string is built, so there's no injection risk from interpolating it.
 */
function findAndPrepareCardScript(libraryId: string): string {
  return `
(() => {
  function countLib(el) { return (el.textContent.match(/Library ID:/g) || []).length; }
  const xpathResult = document.evaluate(
    "//text()[contains(., 'Library ID: ${libraryId}')]",
    document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null,
  );
  const textNode = xpathResult.singleNodeValue;
  if (!textNode) return null;
  let node = textNode.parentElement;
  while (node && node.parentElement && countLib(node.parentElement) === 1) {
    node = node.parentElement;
  }
  if (!node) return null;

  // Scroll so the card sits near the BOTTOM of the viewport, as far as
  // possible from the top — the Ad Library's sticky search/filter
  // toolbar otherwise visually covers the top of the card after a
  // default (top-aligned) scrollIntoView, so a screenshot of the card's
  // own bounding box would just show the toolbar instead of the
  // creative underneath.
  node.scrollIntoView({ block: 'end', inline: 'nearest' });
  window.scrollBy(0, -40);

  const video = node.querySelector('video');
  if (video) {
    try { video.pause(); video.currentTime = 0; } catch (e) {}
    const overlay = document.createElement('div');
    overlay.setAttribute('data-cw-play-overlay', '1');
    overlay.style.position = 'absolute';
    overlay.style.top = '50%';
    overlay.style.left = '50%';
    overlay.style.transform = 'translate(-50%, -50%)';
    overlay.style.width = '48px';
    overlay.style.height = '48px';
    overlay.style.borderRadius = '50%';
    overlay.style.background = 'rgba(0,0,0,0.55)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '999';
    overlay.innerHTML = '<div style="width:0;height:0;border-top:10px solid transparent;border-bottom:10px solid transparent;border-left:16px solid white;margin-left:3px;"></div>';
    const container = video.closest('div') || video.parentElement;
    if (container) {
      if (window.getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
      }
      container.appendChild(overlay);
    }
  }
  return node;
})()
`;
}

/**
 * Screenshots one ad card's creative to a local file — never a hotlinked
 * Meta image URL, since those expire. Returns the saved path, or null if
 * the card couldn't be found or the screenshot failed.
 */
async function captureCardScreenshot(
  page: import("playwright").Page,
  libraryId: string,
  competitorDomain: string,
): Promise<string | null> {
  if (!/^\d+$/.test(libraryId)) return null; // guards the string interpolation above
  try {
    const dir = `${SCREENSHOT_DIR}/${competitorDomain.replace(/[^a-z0-9.-]/gi, "_")}`;
    mkdirSync(dir, { recursive: true });
    const outPath = `${dir}/${libraryId}.png`;
    const handle = await page.evaluateHandle(findAndPrepareCardScript(libraryId));
    // Cast through Playwright's own ElementHandle type (not a DOM-lib
    // Node/Element) so this resolves the same way whether or not the
    // caller's tsconfig includes the "dom" lib — asElement()'s inferred
    // return type otherwise collapses to `never` under some tsconfigs.
    const el = handle.asElement() as import("playwright").ElementHandle | null;
    if (!el) return null;
    await page.waitForTimeout(400); // let the centering scroll and any video pause/seek settle
    // Not el.screenshot() — that call does its OWN scrollIntoViewIfNeeded
    // first (default alignment, not centered), which would undo the
    // centering above and put the sticky toolbar back over the card. A
    // viewport screenshot clipped to the element's current bounding box
    // avoids that second, unwanted scroll.
    const box = await el.boundingBox();
    if (!box) return null;
    const buffer = await page.screenshot({ clip: box });
    // Resized to a small thumbnail — these are only ever shown as
    // thumbnails, never full-size, and the smaller file is faster to
    // write/copy/serve for every live run.
    await sharp(buffer)
      .resize({ width: THUMBNAIL_MAX_WIDTH, withoutEnlargement: true })
      .toFile(outPath);
    return outPath;
  } catch {
    return null;
  }
}

const MONTH_ABBREVIATIONS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

/** Parses "18 Aug 2026" (Ad Library's visible date format) into "2026-08-18". */
function parseAdLibraryDate(raw: string): string | null {
  const m = /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/.exec(raw.trim());
  if (!m?.[1] || !m[2] || !m[3]) return null;
  const month = MONTH_ABBREVIATIONS[m[2].slice(0, 3).toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${month}-${m[1].padStart(2, "0")}`;
}

/** Everything between the "Sponsored" marker and a reasonable length cap, as the ad's visible creative text. */
function extractAdText(rawText: string): string {
  const idx = rawText.indexOf("Sponsored");
  const afterSponsored = idx >= 0 ? rawText.slice(idx + "Sponsored".length) : rawText;
  return afterSponsored.trim().slice(0, 300);
}

// Facebook's own fixed CTA button labels, used to find where the card's
// own ad copy ends and its link-preview/button boilerplate begins.
const CTA_LABELS = [
  "Shop Now",
  "Learn More",
  "Sign Up",
  "Get Offer",
  "Download",
  "Book Now",
  "Contact Us",
  "Apply Now",
  "Get Quote",
  "Subscribe",
  "Watch More",
  "Install Now",
  "Send Message",
  "Call Now",
  "Get Directions",
  "Use App",
  "Donate Now",
  "Play Game",
  "Order Now",
];

/**
 * Isolates the ad's own opening copy from the card's surrounding
 * boilerplate (a concatenated link-preview domain/headline, a video
 * duration readout, a CTA button label) — a direct quote of what the
 * advertiser actually wrote, not a summary. Best effort: Meta's card
 * markup isn't documented, so these cues are common cases, not
 * exhaustive. Falls back to a plain truncation if cutting at the
 * earliest cue would leave nothing useful.
 */
function extractHook(afterSponsored: string): string | null {
  const trimmed = afterSponsored.trim();
  if (!trimmed) return null;
  let cutAt = trimmed.length;

  const domainMatch = /[A-Z0-9][A-Z0-9-]{1,}\.(COM|NET|ORG|IO|CO|SHOP)\b/.exec(trimmed);
  if (domainMatch) cutAt = Math.min(cutAt, domainMatch.index);

  const timestampMatch = /\d:\d\d\s*\/\s*\d:\d\d/.exec(trimmed);
  if (timestampMatch) cutAt = Math.min(cutAt, timestampMatch.index);

  for (const label of CTA_LABELS) {
    const idx = trimmed.indexOf(label);
    if (idx >= 0) cutAt = Math.min(cutAt, idx);
  }

  const hook = trimmed.slice(0, cutAt).trim();
  return hook.length >= 12 ? hook : trimmed.slice(0, 160);
}

/** Reads the "This ad has multiple versions" flag and, when present, "N ads use this creative and text" — both stated directly on the card, not inferred. */
function extractMultiVersionSignal(rawText: string): {
  hasMultipleVersions: boolean;
  creativeVariantCount: number | null;
} {
  const hasMultipleVersions = /This ad has multiple versions/i.test(rawText);
  const variantMatch = /(\d+)\s+ads?\s+use this creative and text/i.exec(rawText);
  return {
    hasMultipleVersions,
    creativeVariantCount: variantMatch?.[1] ? Number(variantMatch[1]) : null,
  };
}

const PROBABLY_PERFORMING_EXPLANATION =
  "Marked probably performing because it has run the longest of this competitor's active ads. Days running is the only signal available — Meta does not publish spend or sales for commercial ads, so this is a proxy, not a measurement of performance.";

/** Picks the top-N ads by days running and marks them — the only ones kept in the result. */
function selectTopAds(ads: AdFinding[], n: number): AdFinding[] {
  const sorted = [...ads].sort((a, b) => (b.daysRunning ?? -1) - (a.daysRunning ?? -1));
  const top = sorted.slice(0, n);
  for (const ad of top) {
    ad.probablyPerforming = true;
    ad.explanation = PROBABLY_PERFORMING_EXPLANATION;
  }
  return top;
}

function buildAdFinding(card: RawAdCard): AdFinding {
  const startDate = parseAdLibraryDate(card.startDateRaw);
  const idx = card.rawText.indexOf("Sponsored");
  const afterSponsored = idx >= 0 ? card.rawText.slice(idx + "Sponsored".length) : card.rawText;
  const { hasMultipleVersions, creativeVariantCount } = extractMultiVersionSignal(card.rawText);
  return {
    libraryId: card.libraryId,
    adText: extractAdText(card.rawText),
    hook: extractHook(afterSponsored),
    hasMultipleVersions,
    creativeVariantCount,
    adUrl: `https://www.facebook.com/ads/library/?id=${card.libraryId}`,
    startDate,
    daysRunning: startDate
      ? Math.floor((Date.now() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24))
      : null,
    platform: "meta",
    probablyPerforming: false,
    explanation: null,
    screenshotPath: null,
  };
}

/** What's known so far, updated as headlessReadCore progresses — read by the timeout wrapper if it has to salvage a result. */
interface ReadProgress {
  facebookPageUrl: string | null;
  resolvedPageId: string | null;
  scopedUrl: string | null;
  rawCards: RawAdCard[];
}

/**
 * The actual read, against an already-open page. Shared by the
 * sequential (throttled, single page) and parallel (one tab per
 * competitor, no cross-tab throttle) callers below — only `gotoFn`
 * differs between them. Does not touch the cache; callers do. Reports
 * progress into `progress` as it goes, so `readWithTabTimeout` below can
 * salvage a partial result if this takes too long.
 */
async function headlessReadCore(
  page: import("playwright").Page,
  competitorDomain: string,
  gotoFn: GotoFn,
  progress: ReadProgress,
): Promise<AdsResult> {
  const capturedAt = new Date().toISOString();
  const notEnoughData = (
    reason: string,
    facebookPageUrl: string | null = null,
    wallScreenshotPath?: string,
  ): AdsResult => ({
    status: "not_enough_data",
    reason,
    source: "headless_ad_library_read",
    facebookPageUrl,
    facebookPageMatched: false,
    resolvedPageId: null,
    totalAdsFound: 0,
    ads: [],
    sourceUrl: null,
    capturedAt,
    wallScreenshotPath,
  });

  const identity = await findSocialIdentity(competitorDomain);
  progress.facebookPageUrl = identity.facebookUrl;
  if (!identity.facebookUrl && !identity.instagramHandle && !identity.siteBrandName) {
    return notEnoughData("no_facebook_link_found_on_competitor_site");
  }

  const resolved = identity.facebookUrl
    ? await resolvePageId(page, identity.facebookUrl, gotoFn, competitorDomain)
    : await resolveViaInstagramOrBrandName(page, identity, gotoFn, competitorDomain);
  if (!resolved.matched || !resolved.pageId) {
    return notEnoughData(
      resolved.reason ?? "page_not_matched",
      identity.facebookUrl,
      resolved.wallScreenshotPath,
    );
  }
  progress.resolvedPageId = resolved.pageId;

  const scopedUrl = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&view_all_page_id=${resolved.pageId}`;
  progress.scopedUrl = scopedUrl;
  await gotoFn(page, scopedUrl);

  const rawCards = await scrollAndCollectCards(page, MAX_AD_CARDS, (cards) => {
    progress.rawCards = cards;
  });
  if (rawCards.length === 0) {
    return {
      status: "not_enough_data",
      reason: "zero_ad_cards_found_for_matched_page",
      source: "headless_ad_library_read",
      facebookPageUrl: identity.facebookUrl,
      facebookPageMatched: true,
      resolvedPageId: resolved.pageId,
      totalAdsFound: 0,
      ads: [],
      sourceUrl: scopedUrl,
      capturedAt,
    };
  }

  const allAds: AdFinding[] = rawCards.map(buildAdFinding);
  // Sorted and sliced to the top 3 BEFORE screenshotting — only those 3
  // ever get a screenshot, never the full list of up to 50 cards.
  const topAds = selectTopAds(allAds, TOP_N_PROBABLY_PERFORMING);
  for (const ad of topAds) {
    ad.screenshotPath = await captureCardScreenshot(page, ad.libraryId, competitorDomain);
  }

  return {
    status: "ok",
    source: "headless_ad_library_read",
    facebookPageUrl: identity.facebookUrl,
    facebookPageMatched: true,
    resolvedPageId: resolved.pageId,
    totalAdsFound: rawCards.length,
    ads: topAds,
    sourceUrl: scopedUrl,
    capturedAt,
  };
}

const TAB_TIMEOUT_MS = 30_000;

/**
 * Runs headlessReadCore with a 30s cap. If it doesn't finish in time,
 * salvages whatever cards were read so far: ranks and screenshots them
 * as normal if there are at least 3, otherwise reports "not enough
 * data" rather than a thin, unranked result. The orphaned core promise
 * (if it eventually settles) is swallowed, not awaited further — the
 * page may be closed by the caller right after this returns.
 */
async function readWithTabTimeout(
  page: import("playwright").Page,
  competitorDomain: string,
  gotoFn: GotoFn,
): Promise<AdsResult> {
  const progress: ReadProgress = {
    facebookPageUrl: null,
    resolvedPageId: null,
    scopedUrl: null,
    rawCards: [],
  };
  const corePromise = headlessReadCore(page, competitorDomain, gotoFn, progress);

  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), TAB_TIMEOUT_MS);
  });

  const winner = await Promise.race([corePromise, timeoutPromise]);
  clearTimeout(timer!);
  if (winner !== "timeout") {
    return winner;
  }

  corePromise.catch(() => {}); // the core call keeps running in the background; don't let its eventual rejection go unhandled
  const capturedAt = new Date().toISOString();
  const cardCount = progress.rawCards.length;

  if (cardCount < 3) {
    console.log(
      `  [ads] ${competitorDomain}: tab timeout after ${TAB_TIMEOUT_MS}ms with only ${cardCount} card(s) read, not enough to rank`,
    );
    return {
      status: "not_enough_data",
      reason: `tab_timeout_after_30s_only_${cardCount}_cards_read`,
      source: "headless_ad_library_read",
      facebookPageUrl: progress.facebookPageUrl,
      facebookPageMatched: progress.resolvedPageId !== null,
      resolvedPageId: progress.resolvedPageId,
      totalAdsFound: cardCount,
      ads: [],
      sourceUrl: progress.scopedUrl,
      capturedAt,
    };
  }

  console.log(
    `  [ads] ${competitorDomain}: tab timeout after ${TAB_TIMEOUT_MS}ms, using the ${cardCount} card(s) already read`,
  );
  const allAds: AdFinding[] = progress.rawCards.map(buildAdFinding);
  const topAds = selectTopAds(allAds, TOP_N_PROBABLY_PERFORMING);
  for (const ad of topAds) {
    ad.screenshotPath = await captureCardScreenshot(page, ad.libraryId, competitorDomain).catch(
      () => null,
    );
  }
  return {
    status: "ok",
    reason: "tab_timeout_after_30s_used_partial_results",
    source: "headless_ad_library_read",
    facebookPageUrl: progress.facebookPageUrl,
    facebookPageMatched: true,
    resolvedPageId: progress.resolvedPageId,
    totalAdsFound: cardCount,
    ads: topAds,
    sourceUrl: progress.scopedUrl,
    capturedAt,
  };
}

export async function fetchAdsViaHeadlessRead(competitorDomain: string): Promise<AdsResult> {
  const cached = readCache(competitorDomain);
  if (cached) return cached;

  let page: import("playwright").Page | null = null;
  try {
    const browser = await getSharedBrowser();
    page = await browser.newPage();
    const result = await readWithTabTimeout(page, competitorDomain, politeGoto);
    writeCache(competitorDomain, result);
    return result;
  } catch (err) {
    const result: AdsResult = {
      status: "not_enough_data",
      reason: `headless_read_error: ${err instanceof Error ? err.message : "unknown"}`,
      source: "headless_ad_library_read",
      facebookPageUrl: null,
      facebookPageMatched: false,
      resolvedPageId: null,
      totalAdsFound: 0,
      ads: [],
      sourceUrl: null,
      capturedAt: new Date().toISOString(),
    };
    writeCache(competitorDomain, result);
    return result;
  } finally {
    await page?.close();
  }
}

const OVERALL_RUN_TIMEOUT_MS = 120_000;

/**
 * Reads all of a report's competitors (normally 3) in parallel — one
 * browser tab per competitor, no cross-tab navigation throttle — instead
 * of one after another. Each tab is individually capped at 30s
 * (readWithTabTimeout); on top of that, the whole batch is capped at
 * 120s — if that fires, whatever's finished is kept and every
 * still-pending competitor is marked "not enough data" rather than
 * waiting indefinitely. Logs per-competitor and total timing so a live
 * run's actual speed is visible, not just assumed.
 */
export async function fetchAdsForCompetitorsParallel(
  competitors: Array<{ domain: string; markets: string[] }>,
): Promise<Map<string, AdsResult>> {
  const totalStart = performance.now();
  const results = new Map<string, AdsResult>();

  const needsHeadless: Array<{ domain: string; markets: string[] }> = [];
  for (const c of competitors) {
    const viaApi = await fetchAdsViaOfficialApi(c.domain, c.markets);
    if (viaApi.status === "ok") {
      results.set(c.domain, viaApi);
    } else {
      needsHeadless.push(c);
    }
  }

  const allTabsPromise = Promise.all(
    needsHeadless.map(async (c) => {
      const start = performance.now();
      let result = readCache(c.domain);
      if (!result) {
        let page: import("playwright").Page | null = null;
        try {
          const browser = await getSharedBrowser();
          page = await browser.newPage();
          result = await readWithTabTimeout(page, c.domain, fastGoto);
        } catch (err) {
          result = {
            status: "not_enough_data",
            reason: `headless_read_error: ${err instanceof Error ? err.message : "unknown"}`,
            source: "headless_ad_library_read",
            facebookPageUrl: null,
            facebookPageMatched: false,
            resolvedPageId: null,
            totalAdsFound: 0,
            ads: [],
            sourceUrl: null,
            capturedAt: new Date().toISOString(),
          };
        } finally {
          await page?.close();
        }
        writeCache(c.domain, result);
      }
      results.set(c.domain, result);
      const durationMs = Math.round(performance.now() - start);
      console.log(`  [ads] ${c.domain}: ${result.status} in ${durationMs}ms`);
    }),
  );

  let timer: ReturnType<typeof setTimeout>;
  const overallTimeoutPromise = new Promise<"overall_timeout">((resolve) => {
    timer = setTimeout(() => resolve("overall_timeout"), OVERALL_RUN_TIMEOUT_MS);
  });
  const winner = await Promise.race([allTabsPromise, overallTimeoutPromise]);
  clearTimeout(timer!);

  if (winner === "overall_timeout") {
    allTabsPromise.catch(() => {}); // the stragglers keep running in the background; don't await them further here
    const stillPending = needsHeadless.filter((c) => !results.has(c.domain));
    console.log(
      `  [ads] overall run timeout after ${OVERALL_RUN_TIMEOUT_MS}ms, marking ${stillPending.length} still-pending competitor(s) as not enough data: ${stillPending.map((c) => c.domain).join(", ")}`,
    );
    for (const c of stillPending) {
      results.set(c.domain, {
        status: "not_enough_data",
        reason: "overall_run_timeout_after_120s",
        source: "headless_ad_library_read",
        facebookPageUrl: null,
        facebookPageMatched: false,
        resolvedPageId: null,
        totalAdsFound: 0,
        ads: [],
        sourceUrl: null,
        capturedAt: new Date().toISOString(),
      });
    }
  }

  const totalDurationMs = Math.round(performance.now() - totalStart);
  console.log(
    `  [ads] total ad-reading time: ${totalDurationMs}ms for ${competitors.length} competitor(s)`,
  );
  return results;
}

/**
 * Tries both free ad-signal sources in order and reports which, if any,
 * worked. Paid readers (Apify, ScrapeGraphAI, Firecrawl) are deliberately
 * not implemented here — see docs/decisions/002-ad-source-choice.md.
 */
export async function fetchAds(
  competitorDomain: string,
  competitorMarkets: string[],
): Promise<AdsResult> {
  const viaApi = await fetchAdsViaOfficialApi(competitorDomain, competitorMarkets);
  if (viaApi.status === "ok") return viaApi;

  const viaHeadless = await fetchAdsViaHeadlessRead(competitorDomain);
  if (viaHeadless.status === "ok") return viaHeadless;

  return {
    status: "not_enough_data",
    reason: `no_free_ad_source_worked (api: ${viaApi.reason}; headless: ${viaHeadless.reason})`,
    source: "none",
    facebookPageUrl: viaHeadless.facebookPageUrl,
    facebookPageMatched: viaHeadless.facebookPageMatched,
    resolvedPageId: viaHeadless.resolvedPageId,
    totalAdsFound: 0,
    ads: [],
    sourceUrl: null,
    capturedAt: new Date().toISOString(),
  };
}
