# 002: Ad source choice

## Context

PRODUCT_SPEC.md needs an "ads probably performing" signal per competitor. DATA_SOURCES.md lists two free options to try before any paid reader: the official Meta Ad Library API, and a headless read of the public Ad Library page.

## Original attempt (superseded below)

Checked with no model calls via `scripts/spike/check-stores.ts` against 5 real stores (siennanaturals.com, shefit.com, colorfulstandard.com, girlfriend.com, gotain.com). The headless reader searched the Ad Library by bare domain text (e.g. "shefit.com") — a keyword match, not an advertiser lookup. Manually inspecting a rendered page (shefit.com) showed two problems: (1) the `[role='article']` selector didn't match Meta's real markup, missing every real card; (2) the domain-text search returned ads from unrelated businesses (a Vietnamese gym, a Brazilian nutrition brand) that happened to share a word with the real brand's name. Ads were left as "not enough data" for all 5 stores and both bugs were logged here as an open problem, not fixed, per the instruction at the time.

## Rewrite — fixed per the plan below

Rewrote `scripts/spike/ads.ts`'s `fetchAdsViaHeadlessRead` end to end, still Playwright (free, local), no paid service:

1. **Find the competitor's own declared Facebook link** on their own site (home page, then `/contact`, `/about`, and Shopify-style variants) via the existing SSRF-safe fetch + cheerio — recorded as the match's source. Share/plugin/tracking links (`sharer.php`, `plugins`, `tr?`, etc.) are excluded so a share button isn't mistaken for the page.
2. **Resolve that link to a numeric Facebook page id** by searching the Ad Library (active ads, all countries) using the page's own slug/id as the query, then reading the page's _embedded result JSON_ (`page_id` / `page_profile_uri` / `page_name` per result) and matching candidates against the footer link exactly — never picking the top result by assumption. No match found → "not enough data," never a keyword-search fallback.
3. **Read that page's own page-scoped Ad Library view** (`view_all_page_id=<id>`), so every card shown is confirmed to belong to the right business — eliminating the old cross-brand contamination entirely.
4. **Parse ad cards by their visible text** — locating every text node containing "Library ID:" via XPath, then climbing to the smallest enclosing element that still contains exactly one such label (so each card's boundary is found structurally, not via a brittle CSS class or `role` attribute). Per ad: library ID, start date ("Started running on"), ad text (everything after "Sponsored"), a direct permalink (`https://www.facebook.com/ads/library/?id=<id>`), and the capture timestamp.
5. **Days running** computed from the parsed start date; the 3 ads with the most days running per competitor are marked `probablyPerforming: true`, each carrying a one-line explanation that days running is the only signal available and spend/sales are never visible for commercial ads — matching GUARDRAILS.md's rule 2.
6. **Politeness**: one shared Playwright browser (not one per competitor), one page open at a time, ≥2s between Ad Library navigations, and a flat-file 7-day cache per domain (`spike-results/ad-library-cache/`) so a repeat run within a week does no new browser work at all.
7. **Abstain, never guess**: no Facebook link found, no advertiser-search match, a login/consent/captcha wall, or zero cards on the matched page's own view all return `status: "not_enough_data"` with a specific reason — never a fallback to the old keyword search.

## Results — first pass, 15 real competitors (3 picks each from the 5 stores' latest Claude-only runs)

| Domain                | Facebook link found | Page matched | Ads found |
| --------------------- | ------------------- | ------------ | --------- |
| mielleorganics.com    | y                   | n            | 0         |
| carolsdaughter.com    | n                   | n            | 0         |
| innersensebeauty.com  | y                   | n            | 0         |
| titlenine.com         | y                   | **y**        | 28        |
| halara.com            | n                   | n            | 0         |
| lornajane.com         | n                   | n            | 0         |
| wearpact.com          | n                   | n            | 0         |
| matethelabel.com      | y                   | **y**        | 26        |
| happyearthapparel.com | y                   | **y**        | 27        |
| quince.com            | y                   | **y**        | 30        |
| indigoluna.store      | y                   | **y**        | 24        |
| womensbest.com        | y                   | **y**        | 27        |
| halfpricedrapes.com   | y                   | **y**        | 17        |
| curtarra.com          | y                   | **y**        | 28        |
| selectblinds.com      | y                   | **y**        | 23        |

11/15 (73%) matched a real page and returned real, verifiable ads — a clean jump from the original 0/5.

## Choice

Ship this rewritten headless reader as the free ad source for Phase 1. It is dramatically more precise than the original (no more cross-brand contamination, every match is confirmed against the competitor's own declared page) and still free. The official API path stays as the first-tried option when `META_AD_LIBRARY_ACCESS_TOKEN` is set and a competitor targets EU/UK — unchanged by this rewrite.

## Hand-check

Jordan opened the ad permalinks for quince.com, curtarra.com and titlenine.com by hand. All three showed the correct brand, matching start dates, and active ads — confirms the page-id matching is not just internally consistent but actually correct against the live Ad Library UI.

## Second pass — two more fixes

1. **Scroll-to-load, capped at 150, with a separate total count.** The matched page's scoped Ad Library view is now scrolled (checking the rendered "Library ID:" count after each scroll) until two scrolls in a row load nothing new, or 150 cards are reached. The result now reports `totalAdsFound` (the real total on the page, after scrolling) separately from `ads` (only the top 3 by days running, which is all that's kept in full detail/screenshots).
2. **Brand-name fallback search.** If the slug/id search returns zero results, the reader now also fetches the competitor's own Facebook page and reads its real display name (`og:title`), then searches the Ad Library by that name instead. Either way, a result is only ever accepted if its own declared page link matches the footer link exactly — never a fallback to accepting an unmatched top result.

### Results — same 15 competitors, with both fixes

| Domain                | Facebook link found | Page matched | Total ads found  |
| --------------------- | ------------------- | ------------ | ---------------- |
| mielleorganics.com    | y                   | n            | 0                |
| carolsdaughter.com    | n                   | n            | 0                |
| innersensebeauty.com  | y                   | n            | 0                |
| titlenine.com         | y                   | **y**        | **120**          |
| halara.com            | n                   | n            | 0                |
| lornajane.com         | n                   | n            | 0                |
| wearpact.com          | n                   | n            | 0                |
| matethelabel.com      | y                   | **y**        | **96**           |
| happyearthapparel.com | y                   | **y**        | **60**           |
| quince.com            | y                   | **y**        | **150 (capped)** |
| indigoluna.store      | y                   | **y**        | **150 (capped)** |
| womensbest.com        | y                   | **y**        | **150 (capped)** |
| halfpricedrapes.com   | y                   | **y**        | **43**           |
| curtarra.com          | y                   | **y**        | **58**           |
| selectblinds.com      | y                   | **y**        | **41**           |

Scrolling revealed the real totals were far higher than the first pass's single-screenful counts (e.g. titlenine.com: 28 → 120; quince.com: 30 → 150+). Match rate stayed 11/15 — the brand-name fallback did NOT recover `mielleorganics.com` or `innersensebeauty.com` this run: both Facebook pages were found correctly, but the Ad Library returned zero results for both the page's slug AND its real display name. These two still correctly report "not enough data" rather than guessing, but the fallback's actual benefit remains unproven on this batch — it may help a page whose slug and display name differ more, or whose ads are indexed under yet another name. Still never a keyword-search-the-domain fallback.

Same 4 non-matches as before, for the same reasons: `carolsdaughter.com`, `halara.com`, `lornajane.com`, `wearpact.com` had no Facebook link found on the pages checked; `mielleorganics.com`, `innersensebeauty.com` had a real link but zero Ad Library results under either name tried.

## Open problem (worth fixing before relying on full coverage)

The keyword-search discovery step (now tried twice — slug, then brand name) can still miss a page that has zero results under both queries, even though the exact-match step afterward is reliable once a candidate is found. A more complete fix would call the official Ad Library API's page-search endpoint (if accessible without the full `ads_archive` scope) purely to resolve page ids, falling back to this keyword-search approach only if that's unavailable. Not done here — flagged for a follow-up, not blocking Phase 1 given the 73% hit rate and zero fabrication risk either way.

## Cost

\$0 — Playwright is free and local; the official API path (unchanged) requires only a free developer token. No paid ad-reader (Apify, ScrapeGraphAI, Firecrawl) used or proposed.
