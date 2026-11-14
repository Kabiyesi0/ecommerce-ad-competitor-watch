# 001: Model provider choice

## Context

We built `ModelClient` as a swappable interface and compared Claude
(claude-haiku-4-5), GLM-4.7-Flash (Z.ai), and a Llama model on Cerebras
on the same 5 real stores (siennanaturals.com, shefit.com,
colorfulstandard.com, girlfriend.com, gotain.com), scoring each on valid
structured output, acceptable competitor picks, and moves that cite real
findings. Cerebras was ruled out earlier for cost/instability reasons
before any real spend (`CEREBRAS_API_KEY` stayed empty throughout), so
the live comparison was Claude vs. GLM, run blind (labels A/B, mapping
kept in a separate `-key.json` per store) across all 5 stores.

## What we found

**GLM fabricated findings outright.** On colorfulstandard.com, the
shared classification step failed for that store (see "Open problem"
below), which should have meant "not enough data" for the moves step.
Claude produced zero moves when there was nothing to cite. GLM instead
invented three fully fictional competitor product launches with
specific, false dates — citing finding ids `F_2`, `F_3`, `F_4` that
never existed in any findings list:

- "Columbia Sportswear introduced the Bugaboot III on November 27, 2023."
- "The North Face launched the Thermoball Eco on January 25, 2024."
- "Patagonia released the Black Hole 60L Duffel on February 16, 2024."

None of these brands were ever candidates for this store. This is
exactly the fabrication GUARDRAILS.md's "no fabricated findings" rule
exists to prevent, and it happened with an empty findings list — the
worst-case input, where the only correct answer is "not enough data."

**GLM was also slow and unreliable.** Latency across the 5-store run:
GLM 33s-192s per store-run vs. Claude's 7-12s — a 3-20x gap. GLM also hit
Z.ai's free-tier rate limit (429) on 4 of 5 runs (shefit.com,
siennanaturals.com, girlfriend.com, gotain.com), each requiring a
retry-with-backoff already built into the OpenAI-compatible adapter.
Claude hit zero 429s across all 5 runs.

**Cost was not the deciding factor** — GLM's free tier was \$0 per call
(when it didn't fabricate) and Claude cost roughly \$0.01-0.02 per
store-run, both trivial at this volume. The deciding factor was that a
free, fast model that invents competitor names and dates is unusable for
a tool whose entire value proposition is "no fabricated findings."

## Choice

**Claude only**, going forward. The GLM and Cerebras adapters stay in
the codebase behind the same `ModelClient` interface — not deleted, just
unused by `compare-models.ts` and `run-spike.ts`'s default — so either
could be reconsidered later if a provider fixes grounding behavior, or
simply swapped back in behind the same interface for a one-line change.

## Open problem found along the way (not part of this decision, logged

here since it surfaced during the comparison)
`classifyStore` failed for colorfulstandard.com on **every run**, for
both providers, independent of the provider comparison. Root cause: the
store ships to roughly 28 EU countries, all listed on its own site, and
`StoreProfileSchema.markets` in `scripts/spike/schema.ts` caps the array
at `max(10)`. Claude (and GLM) faithfully extracted all ~28 markets from
real page content, which then fails schema validation on both the first
attempt and the one retry — this is real data exceeding an arbitrary
limit, not a formatting or prompt-injection problem. Not fixed as part
of this decision; left as "not enough data" for this store, consistent
with the no-fabrication rule, and flagged for a follow-up fix (raise the
cap, or have the prompt ask for the top 10 markets by relevance instead
of capping after the fact).

## Cost

\$0 beyond the already-measured spike run costs (~\$0.05-0.06 per store
for the 2-provider comparison; Claude-only runs going forward will be
roughly half that, under \$0.02/store). No new paid service introduced.
