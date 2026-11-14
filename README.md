# Competitor Watch

A small web tool Jordan Lane sends to e-commerce brand owners as a cold outreach hook. The owner enters their store URL and up to 3 competitor URLs; the tool reads competitors' ads and new products and shows a one-page report. See `CLAUDE.md` and `docs/` for the full product spec, guardrails, and architecture.

## Running locally

- Main pipeline scripts: `npm install`, then see `package.json` for `spike`/`generate-report-fixture`/etc.
- UI prototype: `cd app-prototype && npm install && npm run dev` (serves on `localhost:4000`).

## Free mode vs AI mode

The default, deployed flow is **free mode**: no Claude API calls, ever. See `docs/decisions/007-free-mode.md`.

An AI-powered pipeline (classify → search → pick competitors → suggest moves) also exists in the codebase, dormant behind a feature flag, `AI_MODE` (default off, see `src/lib/ai-mode.ts`). It's for local development only.

**`ANTHROPIC_API_KEY` must never be set in Vercel's (or any deployed) environment for this app.** Free mode needs no key at all. Keep the key in your local `.env.local` only, and only set `AI_MODE=on` locally when you're deliberately testing the AI pipeline.
