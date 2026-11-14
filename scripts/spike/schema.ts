import { z } from "zod";

// markets has a generous cap at the schema level (a real store can ship
// to dozens of countries) so a long, honest list never fails validation.
// classifyStore truncates it to the first 10 for callers and records the
// real total separately — see StoreProfile.marketsTotalCount below.
export const StoreProfileSchema = z.object({
  category: z.string(),
  priceTier: z.enum(["budget", "mid", "premium"]),
  markets: z.array(z.string()).max(60),
  productKeywords: z.array(z.string()).max(10),
  confidence: z.enum(["low", "medium", "high"]),
});
type RawStoreProfile = z.infer<typeof StoreProfileSchema>;
export interface StoreProfile extends RawStoreProfile {
  /** The number of markets the model actually listed, before truncation to 10. */
  marketsTotalCount: number;
}

export const CandidateSchema = z.object({
  domain: z.string(),
  name: z.string(),
  whyPicked: z.string(),
});
export type Candidate = z.infer<typeof CandidateSchema>;

export const CandidateListSchema = z.object({
  candidates: z.array(CandidateSchema).max(3),
});

export const ProductSchema = z.object({
  title: z.string(),
  url: z.string(),
  publishedAt: z.string().nullable(),
});
export type Product = z.infer<typeof ProductSchema>;

export type DataStatus = "ok" | "not_enough_data";

export interface ProductsResult {
  status: DataStatus;
  reason?: string;
  dateBasis: "real_dates" | "listing_order" | "none";
  products: Product[];
  sourceUrl: string;
  capturedAt: string;
}

export interface AdFinding {
  libraryId: string;
  /** The ad's text as shown in the card, not a landing page — kept separate from adUrl. */
  adText: string;
  /** The ad's own opening copy, isolated from the card's link-preview/CTA-button boilerplate on a best-effort basis — a direct quote, not a summary. Null if nothing reliable could be isolated. */
  hook: string | null;
  /** True if the Ad Library card itself says "This ad has multiple versions" — the advertiser is testing variants of this exact ad. */
  hasMultipleVersions: boolean;
  /** Parsed from "N ads use this creative and text" when the card states it — null otherwise. */
  creativeVariantCount: number | null;
  adUrl: string;
  daysRunning: number | null;
  startDate: string | null;
  platform: string;
  /** True for the top-N ads by days running — the only signal available, not spend or sales. */
  probablyPerforming: boolean;
  explanation: string | null;
  /** Local file path to a screenshot of the ad's creative, or null if capture failed/was skipped. Never a hotlinked Meta URL — those expire. */
  screenshotPath: string | null;
}

export interface AdsResult {
  status: DataStatus;
  reason?: string;
  source: "meta_ad_library_api" | "headless_ad_library_read" | "none";
  /** The Facebook page link found on the competitor's own site — recorded as the source for the match, not fetched from Facebook. */
  facebookPageUrl: string | null;
  /** True once the Ad Library result was confirmed to be the SAME page as facebookPageUrl, not a keyword-matched guess. */
  facebookPageMatched: boolean;
  resolvedPageId: string | null;
  /** Total active ads found on the matched page (after scrolling, capped at 150) — `ads` below only carries the top few by days running. */
  totalAdsFound: number;
  ads: AdFinding[];
  sourceUrl: string | null;
  capturedAt: string;
  /** Local screenshot of what the page actually showed when a wall/captcha/unexpected-content reason fired, so a human can see what we're fighting. */
  wallScreenshotPath?: string;
}

export const MoveSchema = z.object({
  competitorObservation: z.string(),
  /** 1 or 2 finding ids — may span ads and products, and more than one competitor. */
  citedFindingIds: z.array(z.string()).min(1).max(2),
  suggestion: z.string(),
});
export type Move = z.infer<typeof MoveSchema>;

export const MoveListSchema = z.object({
  moves: z.array(MoveSchema).length(3),
});

/**
 * A single labeled, citable fact pulled from a competitor's products/ads
 * data. The comparison-only moves check (compare-suggest-moves.ts) grounds
 * each model-proposed move against a list of these — a move citing an id
 * not in this list fails automatically.
 */
export interface Finding {
  id: string;
  competitorDomain: string;
  kind: "product" | "ad";
  summary: string;
  /** A direct link to the product page or ad, for a clean "View product"/"View ad" source line — null if unavailable. */
  url: string | null;
  /** ISO date (publish or ad-start date), for a clean "Mon D, YYYY" source line — null if unavailable. */
  date: string | null;
}

export interface SpikeStoreResult {
  storeUrl: string;
  capturedAt: string;
  profile: StoreProfile | null;
  /** Which ModelClient's picks were used for this run's competitors. */
  providerUsed: "claude" | "glm" | "llama-cerebras" | "none";
  competitors: Candidate[];
  perCompetitor: Array<{
    competitor: Candidate;
    products: ProductsResult;
    ads: AdsResult;
  }>;
}
