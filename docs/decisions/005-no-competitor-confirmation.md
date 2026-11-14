# 005: Remove the competitor confirmation step

## Context

The UI prototype's flow was landing -> confirm competitors -> running -> report. The confirm step asked the owner to keep, remove, or replace each of the 3 picked competitors before the report would run.

## Choice

Remove the confirm step. The flow is now landing -> running -> report.

## Why

Competitor Watch is a free cold-outreach hook, not a paid tool the owner has committed to. Every extra screen and decision between "enter my URL" and "see something useful" is a chance to drop off. A confirm screen asks the owner to evaluate 3 unfamiliar domain names and make a judgment call before they have seen any value at all — that is real friction, for a tool whose entire job is to earn a reply, not to be operated correctly.

An occasional weak competitor pick is a cheap mistake: the owner still sees 2 good picks, real ads, real products, and 3 moves. A dropped-off owner before the report ever loads is not recoverable. Given the choice between "sometimes show a so-so third competitor" and "sometimes lose the owner before they see the report," the so-so competitor is clearly cheaper.

Wrong picks are handled downstream instead of upstream: the report now tells the owner plainly who we picked and invites them to reply if they want a different set of competitors covered. This moves the correction into the outreach conversation Jordan is already having, where a reply is itself a positive signal, rather than making every owner review picks for a tool they have not yet seen the value of.

## What this does not change

- Competitor picking itself is unchanged — still 3 picks, still through `pickCompetitors`'s candidate-pool validation.
- If fewer than 3 real candidates exist, the report says so plainly rather than padding with a weak pick to reach 3 (see the Report changes in the same commit).

## Cost

\$0 — this is a product/UX decision, not a new data source or paid service.
