export interface AdFixture {
  libraryId: string;
  adText: string;
  /** The ad's own opening copy, a direct quote isolated from the card's link-preview/CTA boilerplate — null if nothing reliable could be isolated. */
  hook: string | null;
  /** The advertiser is testing multiple versions of this exact ad, per the Ad Library's own card. */
  hasMultipleVersions: boolean;
  /** How many ads use this exact creative and text, when the card states it. */
  creativeVariantCount: number | null;
  adUrl: string;
  startDate: string | null;
  daysRunning: number | null;
  probablyPerforming: boolean;
  explanation: string | null;
  screenshotUrl: string | null;
}

export interface CompetitorFixture {
  domain: string;
  name: string;
  whyPicked: string;
  adsStatus: "ok" | "not_enough_data";
  adsReason?: string;
  totalAdsFound: number;
  topAds: AdFixture[];
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

export type StartInput = { kind: "demo"; id: string } | { kind: "live"; url: string };

/** The free-mode flow (see docs/decisions/007-free-mode.md). Additive — StartInput above is kept for the dormant AI-mode flow. */
export type FreeStartInput =
  { kind: "demo"; id: string } | { kind: "free"; storeUrl: string; competitorUrls: string[] };

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
