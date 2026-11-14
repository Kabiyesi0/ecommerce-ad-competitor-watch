import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CompetitorCard } from "./CompetitorCard";
import type { CompetitorFixture } from "../lib/types";
import { STORES } from "../lib/stores";

afterEach(cleanup);

/**
 * Regression test for a real bug class: a fixture can report ads
 * (totalAdsFound > 0, topAds populated) while the report UI shows none
 * — e.g. a stray status check, a filter condition that doesn't match
 * the data shape, or a prop never wired through. This fails loudly if
 * that ever happens again, instead of only showing up as "0 active
 * ads" on a real store that actually has ads.
 */
describe("CompetitorCard renders every ad the fixture provides", () => {
  function buildFixture(overrides: Partial<CompetitorFixture> = {}): CompetitorFixture {
    return {
      domain: "example.com",
      name: "Example",
      whyPicked: "test fixture",
      adsStatus: "ok",
      totalAdsFound: 3,
      topAds: [
        {
          libraryId: "1",
          adText: "Ad one",
          hook: "Ad one",
          hasMultipleVersions: false,
          creativeVariantCount: null,
          adUrl: "https://facebook.com/ads/library/?id=1",
          startDate: "2026-01-01",
          daysRunning: 90,
          probablyPerforming: true,
          explanation: "test",
          screenshotUrl: null,
        },
        {
          libraryId: "2",
          adText: "Ad two",
          hook: "Ad two",
          hasMultipleVersions: false,
          creativeVariantCount: null,
          adUrl: "https://facebook.com/ads/library/?id=2",
          startDate: "2026-01-02",
          daysRunning: 80,
          probablyPerforming: true,
          explanation: "test",
          screenshotUrl: null,
        },
      ],
      productsStatus: "not_enough_data",
      newProducts: [],
      productsSourceUrl: "https://example.com/products.json",
      productsCapturedAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    };
  }

  it("renders one ad-thumbnail per item in topAds when status is ok", () => {
    const fixture = buildFixture();
    render(<CompetitorCard competitor={fixture} defaultOpen={true} />);
    expect(screen.getAllByTestId("ad-thumbnail")).toHaveLength(fixture.topAds.length);
  });

  it("renders ad thumbnails even when the card starts collapsed (defaultOpen=false)", () => {
    // The outer collapse is a CSS height transition, not conditional
    // rendering — ad cards must still be in the DOM so expanding is instant.
    const fixture = buildFixture();
    render(<CompetitorCard competitor={fixture} defaultOpen={false} />);
    expect(screen.getAllByTestId("ad-thumbnail")).toHaveLength(fixture.topAds.length);
  });

  it("shows 'Not enough data' and zero thumbnails when there genuinely are no ads", () => {
    const fixture = buildFixture({ adsStatus: "not_enough_data", totalAdsFound: 0, topAds: [] });
    render(<CompetitorCard competitor={fixture} defaultOpen={true} />);
    expect(screen.queryAllByTestId("ad-thumbnail")).toHaveLength(0);
    expect(screen.getAllByText("Not enough data").length).toBeGreaterThan(0);
  });

  it("fails the underlying data invariant if a real fixture ever reports ads found but none retained", () => {
    for (const store of STORES) {
      for (const competitor of store.fixture.competitors) {
        if (competitor.totalAdsFound > 0) {
          expect(
            competitor.topAds.length,
            `${store.id}/${competitor.domain}: totalAdsFound=${competitor.totalAdsFound} but topAds is empty`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });

  it("renders the real top ads for every competitor across all 5 fixtures that actually has them", () => {
    for (const store of STORES) {
      for (const competitor of store.fixture.competitors) {
        if (competitor.topAds.length === 0) continue;
        const { unmount } = render(<CompetitorCard competitor={competitor} defaultOpen={true} />);
        expect(
          screen.getAllByTestId("ad-thumbnail"),
          `${store.id}/${competitor.domain} should render ${competitor.topAds.length} ad thumbnail(s)`,
        ).toHaveLength(competitor.topAds.length);
        unmount();
      }
    }
  });
});
