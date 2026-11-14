import * as cheerio from "cheerio";
import { safeFetch } from "../../src/lib/safe-fetch.js";

// Flag before Phase 1: confirm with Jordan what contact address/string this
// should actually carry (an honest crawler identifies a real contact).
const USER_AGENT = "CompetitorWatchBot/0.1 (+contact: contact@example.com)";

const lastRequestAtByHost = new Map<string, number>();
const MIN_INTERVAL_MS = 1000; // ~1 req/sec/host, per GUARDRAILS.md

async function politeDelay(hostname: string): Promise<void> {
  const last = lastRequestAtByHost.get(hostname);
  if (last !== undefined) {
    const elapsed = Date.now() - last;
    if (elapsed < MIN_INTERVAL_MS) {
      await new Promise((resolve) => setTimeout(resolve, MIN_INTERVAL_MS - elapsed));
    }
  }
  lastRequestAtByHost.set(hostname, Date.now());
}

interface RobotsRules {
  disallowedPaths: string[];
}

const robotsCacheByHost = new Map<string, RobotsRules>();

async function getRobotsRules(origin: string): Promise<RobotsRules> {
  const hostname = new URL(origin).hostname;
  const cached = robotsCacheByHost.get(hostname);
  if (cached) return cached;

  let rules: RobotsRules = { disallowedPaths: [] };
  try {
    const result = await safeFetch(new URL("/robots.txt", origin).toString(), {
      userAgent: USER_AGENT,
    });
    if (result.status === 200) {
      const disallowedPaths: string[] = [];
      let appliesToUs = false;
      for (const rawLine of result.html.split("\n")) {
        const line = rawLine.split("#")[0]?.trim() ?? "";
        if (!line) continue;
        const [keyRaw, ...rest] = line.split(":");
        const key = keyRaw?.trim().toLowerCase();
        const value = rest.join(":").trim();
        if (key === "user-agent") {
          appliesToUs = value === "*";
        } else if (key === "disallow" && appliesToUs && value) {
          disallowedPaths.push(value);
        }
      }
      rules = { disallowedPaths };
    }
  } catch {
    // No robots.txt, or it couldn't be fetched — proceed as if everything
    // is allowed, per common crawler convention.
  }
  robotsCacheByHost.set(hostname, rules);
  return rules;
}

function isDisallowed(path: string, rules: RobotsRules): boolean {
  return rules.disallowedPaths.some((prefix) => path.startsWith(prefix));
}

export { getRobotsRules, isDisallowed };
export type { RobotsRules };

export interface FetchedPage {
  url: string;
  html: string;
  text: string;
}

async function fetchPage(url: string): Promise<FetchedPage | null> {
  const parsed = new URL(url);
  const rules = await getRobotsRules(parsed.origin);
  if (isDisallowed(parsed.pathname, rules)) {
    return null;
  }
  await politeDelay(parsed.hostname);
  const result = await safeFetch(url, { userAgent: USER_AGENT });
  if (result.status < 200 || result.status >= 300) return null;
  const $ = cheerio.load(result.html);
  $("script, style, noscript").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  return { url: result.finalUrl, html: result.html, text };
}

function extractInternalLinks(page: FetchedPage, maxLinks: number): string[] {
  const $ = cheerio.load(page.html);
  const origin = new URL(page.url).origin;
  const links = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const resolved = new URL(href, page.url);
      if (resolved.origin !== origin) return;
      if (/\/(products?|collections?)\//i.test(resolved.pathname)) {
        links.add(resolved.toString());
      }
    } catch {
      // ignore unparsable hrefs
    }
    if (links.size >= maxLinks) return false;
  });
  return [...links].slice(0, maxLinks);
}

export interface SiteSample {
  homepage: FetchedPage;
  linkedPages: FetchedPage[];
  combinedText: string;
}

/**
 * Reads a store's homepage plus a handful of linked product/collection
 * pages, through the SSRF-safe fetch module and respecting robots.txt.
 * Used both for the owner's own site and for competitor candidates.
 */
export async function sampleSite(storeUrl: string, maxLinkedPages = 4): Promise<SiteSample> {
  const homepage = await fetchPage(storeUrl);
  if (!homepage) {
    throw new Error(
      `Could not read homepage (blocked by robots.txt or fetch failure): ${storeUrl}`,
    );
  }

  const linkUrls = extractInternalLinks(homepage, maxLinkedPages);
  const linkedPages: FetchedPage[] = [];
  for (const url of linkUrls) {
    const page = await fetchPage(url);
    if (page) linkedPages.push(page);
  }

  const combinedText = [homepage, ...linkedPages]
    .map((p) => p.text)
    .join("\n\n")
    .slice(0, 20_000); // keep the model call's input bounded

  return { homepage, linkedPages, combinedText };
}

export { USER_AGENT };
