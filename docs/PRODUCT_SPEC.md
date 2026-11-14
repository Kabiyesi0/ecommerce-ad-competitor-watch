# Product Spec

## User

An e-commerce brand owner or marketer, not technical. They received a cold email, replied, and got a private link. They will give it about two minutes.

## One sentence

Enter your website and see what your 3 closest competitors are doing, and 3 moves you could make in response.

## Flow

1. Owner opens a private link (random token in the URL).
2. Owner enters their store URL. Nothing else is required. An email field is optional.
3. The tool reads the owner's public site to learn what they sell, their price tier, and their markets.
4. The tool proposes 3 closest competitors. The owner can confirm, remove, or replace any of them before the run continues. This step matters because wrong competitor picks are the biggest accuracy risk.
5. For each competitor the tool collects the signals below.
6. The tool shows a one page report with sources and dates.
7. A "Run again" button is available until the link's quota is used.

## Signals (build in this order)

1. **Ads probably performing.** Active ads from the Meta Ad Library, ranked by how long they have been running, showing hook, offer, format and landing page. Label: "probably performing". Explain once: "Ads that stay live for weeks are usually profitable."
2. **New products.** Products the competitor added recently, from public product data. Only show a date range when the source gives real publish dates. Otherwise say "newest products".
3. **3 suggested moves.** Short, specific, grounded in the findings above. Each move cites the finding it comes from. No generic marketing advice.
4. **Later:** price changes and a weekly digest. These need stored snapshots over time, so they are not part of the first version.

## Report layout

- Header: "Competitor watch for {store}" and "Built from public information on {date}".
- Competitors block (name, URL, why it was picked).
- One card per competitor: ads, new products.
- "3 moves" block with citations.
- Footer: what the tool cannot see (their sales, their spend, anything private).
- Each finding has a source link and a capture date.

## When data is missing

Say so plainly: "No active Meta ads found", "This store does not expose product data". Never fill gaps with guesses.

## Quotas and cost control

- Each link allows a small number of runs (start with 3).
- Links expire (start with 14 days).
- Cache competitor results (start with 7 days) so repeat lookups cost nothing.
- Daily and global budget caps with a kill switch (see GUARDRAILS).

## Admin view for Jordan

A simple private page listing each link: who it was issued to, whether it was opened, how many runs, which store was entered, and the cost spent. This is a warm-lead signal: opened and ran means interested.

## Demo mode for the Loom

A pre-cached run on a sample store so Jordan can record a 90 second video without spending money or risking a live failure.

## Out of scope for version 1

- Accounts, logins, payments.
- Connecting to the owner's Shopify, ad accounts, or email.
- Scraping Amazon or any site that blocks bots.
- Price tracking, weekly emails, change history.
- Any claim about competitor revenue, profit or ad spend.

## Tone

Plain, direct, short sentences. Sounds like one operator talking to another. No hype words.
