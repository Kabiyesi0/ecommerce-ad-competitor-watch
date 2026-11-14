# Data Sources

These are candidates, not requirements. Each item is labeled:

- **Verified (search, Oct 2026):** found in public documentation during planning.
- **Unverified:** from general knowledge. Test before relying on it.

Pricing and limits change. Re-check before committing.

## A. Understanding the owner's own store

Goal: category, price tier, markets, what they sell.

- Fetch the home page, collection pages, and product pages with plain HTTP and an HTML parser. Use a headless browser only when a page needs JavaScript.
- Shopify stores often expose public product data and a sitemap (for example `/products.json`, `/sitemap.xml`). **Unverified.** Some stores disable them. Test on real leads.
- A cheap, small Claude model can classify the store (category, price tier) from a handful of pages.

## B. Finding the 3 closest competitors

Hardest step to get right. Options to evaluate:

1. A search API or search-enabled model call to find similar stores for the same products or category. Check current free tiers and limits. **Unverified.**
2. Use the owner's own product titles as search queries, then filter to stores (not marketplaces, blogs or review sites).
3. Let the owner edit the list. Required in all cases (see PRODUCT_SPEC).
4. Optional: let the owner type competitor URLs themselves as a fallback.

Quality bar: at least 2 of 3 picks should be genuinely comparable (same category, similar price tier, same market).

## C. Ads probably performing (Meta Ad Library)

- Official Ad Library API: **Verified.** For commercial ads it covers audiences in the EU and UK, requires a verified Meta developer account, and returns nothing for US-only commercial ads that are visible on the website.
- Commercial ads do not include spend or impressions publicly. **Verified** across several tool descriptions. Use "days running" as the only proxy.
- Third party readers of the public Ad Library page exist on Apify. **Verified** that they exist. One listing quotes pricing from about $1.20 per 1,000 results. Community-built. One review reported a run that kept going and cost $17, so always set a hard cap.
- Reading the public Ad Library page directly: **Unverified** feasibility and terms. Likely fragile.
- Fields available from such readers: ad copy, creative, platforms, start date, active status, landing page.
- Build this source behind an interface so it can be swapped or turned off.

## D. New products

- Public product feed or sitemap diffing, where available. **Unverified.**
- Real publish dates only if the source provides them. On the first run there is no history, so a "this month" claim is only valid with publish dates.
- Fall back to "newest products" ordering when dates are missing.

## E. Scraping and extraction services (optional)

- ScrapeGraphAI: **Verified** that an MIT-licensed MCP server exists and that a free tier exists. Docs list the free plan as 500 credits per month at 10 requests per minute, with Extract costing about 5 credits. An older pricing page showed different numbers (50 free credits one time), so check the current page. At those limits the free tier is for development, not for many leads.
- Firecrawl: a listing showed 1,000 free credits for new users. **Verified** as advertised. Terms unknown.
- Important: an MCP server is a tool for Claude Code while building. The deployed app should call the service's API or SDK directly, or avoid the service entirely.
- Own code (fetch plus an HTML parser) costs nothing per run and may be enough for most Shopify stores.

## F. Model usage

- Use the cheapest capable Claude model for classification and extraction. Use a stronger model only for the final suggestions if quality needs it.
- Structured output with schema validation.
- Cache by domain. Set token ceilings per run.

## G. Other public signals (later)

Google Ads Transparency Center, TikTok Creative Center, Shopify app listings. All unverified. Do not build in version 1.

## Decision rule

For each signal, pick the cheapest source that passes the quality bar in TEST_PLAN.md. If no source is reliable and cheap enough, drop that signal from version 1 rather than shipping something shaky.
