# 007: Free mode — zero Claude API calls

## Context

Every report so far required `ANTHROPIC_API_KEY` and four Claude calls per run: classify the store, search for candidate competitors, pick 3 of them, then write "3 moves you could make." That put a real marginal cost and an external dependency on every report, for a tool whose whole job is to be a free cold-outreach hook sent to people who have not committed to anything yet.

## Choice

Add a free mode that produces a full report — ads probably performing with days-running, new products with dates and source links — for a store URL plus 1-3 competitor URLs the owner supplies directly, with zero Claude API calls. `AI_MODE` (default off, see `src/lib/ai-mode.ts`) gates every remaining code path that can reach Claude, so the absence of API calls is enforced at the code level, not just assumed by convention. The free flow is now the app's only user-facing entry point. The AI pipeline — classify, search, pick, moves, and all of `src/llm/*` — stays in the codebase exactly as it was, reachable by setting `AI_MODE=on` and supplying `ANTHROPIC_API_KEY`, but is no longer linked from the UI.

## Why

Ad reading (`scripts/spike/ads.ts`) and new-product reading (`scripts/spike/products-shopify.ts`) were already 100% AI-free — Claude was only ever needed to pick competitors and to write prose suggestions. Asking the owner for their own competitors instead of guessing removes the one real AI dependency without losing what the report actually shows. The "3 moves" feature is the one piece that genuinely needed an LLM to write original sentences; it's replaced with a fixed "Rebuild checklist" the owner can act on immediately, without a tailored suggestion. That's an honest trade: free mode tells the owner exactly what it found and what to do with it in general terms, and the footer invites them to reply if they want the tailored version with specific moves — which is also where the paid/AI-assisted path still lives today, dormant behind `AI_MODE`.

## What this does not change

- The AI pipeline's internals are untouched: `classify-store.ts`, `search-candidates.ts`, `find-competitors.ts`, `compare-suggest-moves.ts`, `build-report.ts`, `src/llm/*` all still work exactly as before when `AI_MODE=on` and `ANTHROPIC_API_KEY` is set.
- `ads.ts` and `products-shopify.ts` are unchanged by this work (the ad-matching fixes landed separately, in commit `cf96978`, tagged `v0-ai-version`).
- The 5 original AI-mode demo fixtures (`app-prototype/fixtures/*.json`) are untouched; a parallel `app-prototype/fixtures-free/*.json` set (moves stripped) backs the 5 free-mode demos.
- Competitor picks shown in free mode are never explained with a "why picked" line — the owner typed them, so there is nothing to justify. Only name and domain are shown.

## Deployment warning

`ANTHROPIC_API_KEY` must never be set in Vercel's (or any deployed) environment for this app. Free mode needs no key at all. The dormant `/api/report` route and `AI_MODE` flag exist for local development only — setting the key in a deployed environment, combined with someone later flipping `AI_MODE=on` there, would turn a dormant code path into a live, costed one with no local-use guardrail watching it. Keep the key in local `.env.local` only.

## Cost

$0 per report in free mode — no Claude calls. The AI pipeline, when explicitly re-enabled via `AI_MODE=on`, is unaffected and keeps its existing cost tracking (`src/lib/cost-guard.ts`, `scripts/spike/cost-log.ts`).
