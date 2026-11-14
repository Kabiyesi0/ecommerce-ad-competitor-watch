# Architecture

Claude Code has freedom here. This file gives constraints and a non-binding starting hypothesis.

## Constraints

- Marginal cost per run must stay very low. Jordan sets the ceiling. Suggested starting ceiling: about $0.25 per run, to be revised after the Phase 0 measurements.
- Runs take time. Do not rely on a single short web request. Use a background job or queue and show progress.
- One person maintains this. Prefer boring, widely used tools.
- Hosted on Vercel (Jordan's existing account). Check whether the plan's terms allow commercial use. Unverified.
- Data and code live in Jordan's accounts.

## Non-binding starting hypothesis

- Next.js app on Vercel, Supabase (Postgres) for tokens, runs, cache and logs. This matches Jordan's existing stack.
- Own light crawler (HTTP fetch plus an HTML parser) for the owner's site and for Shopify public product data.
- A small Claude model for classification and extraction, with schema-validated output.
- A pluggable `AdSource` interface. Pick the cheapest source that passes the spike, and keep it swappable.
- A pluggable `CompetitorFinder` interface, with owner editing as a required step.
- A `Report` JSON schema that the page renders. Store the JSON so the page is cheap to reload.

## Questions to answer in docs/decisions

1. How are competitors found, and what is the measured pick quality?
2. Which ad source passes the spike, and what does it cost per 100 runs?
3. Do the owner's and competitors' Shopify public endpoints work often enough to rely on?
4. Where do background jobs run, given serverless time limits?
5. What does a run cost end to end, split by model tokens and data calls?
6. What breaks when a site blocks bots, and how does the page behave?

## Cost model (measured)

Measured from `spike-results/cost-log.csv` on a clean Claude-only
5-store run (siennanaturals.com, shefit.com, colorfulstandard.com,
girlfriend.com, gotain.com; see `docs/decisions/001-model-provider.md`).
This is the real Phase 1 pipeline shape — one classify call feeding one
search call feeding one pick call — not the comparison harness's extra
"reference classification" (an artifact of comparing providers, not
part of the real pipeline).

| Step                       | Source                             | Calls/run | Avg cost/run | Range                                   |
| -------------------------- | ---------------------------------- | --------- | ------------ | --------------------------------------- |
| Read owner site            | Own HTTP crawler (`safe-fetch.ts`) | up to 5   | $0           | $0                                      |
| Classify store (model)     | Claude (`classifyStore`)           | 1         | $0.0078      | $0.0052–$0.0154                         |
| Search candidates (model)  | Claude hosted web search           | 1         | $0.0236      | $0.0199–$0.0347                         |
| Pick competitors (model)   | Claude (`pickCompetitors`)         | 1–2\*     | $0.0026      | $0.0021–$0.0042                         |
| Products for 3 competitors | Shopify `/products.json` + sitemap | 3         | $0           | $0                                      |
| Ads for 3 competitors      | Meta Ad Library (free attempts)    | 3         | $0           | $0 (not enough data — see decision 002) |
| Suggest moves (model)      | Claude (`suggestAndCheckMoves`)    | 1         | $0.0036      | $0.0030–$0.0046                         |
| **Total**                  |                                    |           | **$0.0375**  | $0.0311–$0.0414                         |

\*A second call only happens when `pickCompetitors` rejects a pick
outside the candidate pool and retries once (observed on 2 of 5 stores
in this run).

**Split by step type:**

| Type                                   | Avg cost/run | Share |
| -------------------------------------- | ------------ | ----- |
| Search (shared candidate discovery)    | $0.0236      | 63%   |
| Model (classify + pick + moves)        | $0.0139      | 37%   |
| Data fetches (products, ads, own site) | $0           | 0%    |

The search step — one Claude call using the hosted web-search tool to
gather real-looking competitor domains — is the single biggest cost
driver, roughly 1.7x the combined cost of the three JSON-schema model
calls. This is well under the $0.25/run ceiling in the Constraints
section above, with room to spare even after Phase 1 adds the owner
confirmation step and any retries.

## Interfaces (suggested)

- `CompetitorFinder.find(storeProfile) -> Candidate[]`
- `AdSource.fetch(competitor) -> Ad[]`
- `ProductSource.fetch(competitor) -> Product[]`
- `Suggester.suggest(findings) -> Move[]` (each Move must cite finding ids)

## Observability

Per run: token counts, data-call counts, cost, duration, failures. Per link: runs used, last opened. Surface in the admin page.

## Do not build now

Accounts, payments, scheduled digests, price history, multi-tenant workspaces, a Chrome extension.
