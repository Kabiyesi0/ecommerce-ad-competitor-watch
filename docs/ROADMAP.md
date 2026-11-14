# Roadmap

Stop and report to Jordan at the end of each phase.

## Phase 0: Feasibility spike (about 1 day)

Goal: learn which signals can be collected cheaply and accurately. No UI.

- For 5 real stores (Jordan supplies), try to get: store profile, 3 competitor candidates, ads per competitor, newest products per competitor.
- Try the free or cheapest options first, then the paid ones only if needed and only after asking Jordan.
- Measure cost, time, and accuracy for each source.
- Write docs/decisions entries for competitor finding, ad source, and product source.
- Fill in the cost model in ARCHITECTURE.md.
- **Gate:** if ads cannot be collected reliably and cheaply, propose dropping that signal and shipping products plus suggestions only.

## Phase 1: Pipeline (CLI)

- Command: input a store URL, output a validated Report JSON.
- SSRF protections, rate limits, caching, cost logging.
- Golden set test harness (TEST_PLAN.md).
- **Gate:** pass bars met on the golden set.

## Phase 2: Web page and links

- Private tokens, expiry, run quotas, per-IP limits, budget caps, kill switch.
- Entry form, competitor confirmation step, progress state, report page.
- Admin page for Jordan: links, opens, runs, cost, stores entered.
- Demo mode on a cached sample store for the Loom.

## Phase 3: Suggestions

- "3 moves" step with citations and rejection of ungrounded output.
- Evaluate on the golden set. A wrong or generic suggestion is worse than none.

## Phase 4: Batch for outreach

- CSV of domains in, pre-generated report per lead out, so Jordan can check findings by hand before sending.
- Output sheet: domain, competitors found, headline finding, link token, confidence flags.

## Phase 5: Later

- Stored snapshots for change detection (price changes, new launches over time).
- Weekly digest email.
- Optional connection to the owner's store for deeper findings. This is the paid upsell, so keep it out of the free version.

## Definition of done for the first send

- Golden set passes.
- 5 real leads reviewed by hand.
- Cost per run measured and under Jordan's ceiling.
- Kill switch tested.
