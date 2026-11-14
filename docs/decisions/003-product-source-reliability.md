# 003: Product source reliability

## Context

PRODUCT_SPEC.md needs a "recently launched products" signal per
competitor. DATA_SOURCES.md's free option is Shopify's public
`/products.json` feed (falling back to a sitemap), implemented in
`scripts/spike/products-shopify.ts`. Checked against the 5 real stores
from the model-provider comparison (`docs/decisions/001-model-provider.md`)
plus the 3 competitors each store's Claude run actually picked — 20
domains total.

## What we found

| Domain                       | /products.json | Real dates |
| ---------------------------- | -------------- | ---------- |
| siennanaturals.com (owner)   | yes            | yes        |
| mielleorganics.com           | yes            | yes        |
| carolsdaughter.com           | yes            | yes        |
| innersensebeauty.com         | yes            | yes        |
| shefit.com (owner)           | yes            | yes        |
| titlenine.com                | yes            | yes        |
| halara.com                   | **no**         | —          |
| lornajane.com                | yes            | yes        |
| colorfulstandard.com (owner) | yes            | yes        |
| organicbasics.com            | yes            | yes        |
| wearpact.com                 | **no**         | —          |
| outerknown.com               | yes            | yes        |
| girlfriend.com (owner)       | yes            | yes        |
| quince.com                   | **no**         | —          |
| indigoluna.store             | yes            | yes        |
| womensbest.com               | yes            | yes        |
| gotain.com (owner)           | **no**         | —          |
| halfpricedrapes.com          | yes            | yes        |
| curtarra.com                 | yes            | yes        |
| selectblinds.com             | yes            | yes        |

**16/20 (80%) had `/products.json` available**, and every one of those 16
carried real `created_at` timestamps (`dateBasis: "real_dates"`) — none
fell back to listing-order-only dates in this sample. The 4 misses
(halara.com, wearpact.com, quince.com, gotain.com) all returned
`no_products_json_or_sitemap_available`: the endpoint either 404s or the
store isn't on Shopify at all. For those, `fetchNewProducts` returns
`status: "not_enough_data"` rather than guessing — consistent with
GUARDRAILS.md's no-fabrication rule — and `buildFindings` simply
produces zero findings for that competitor, so moves can't cite it
(rather than citing a stale or fabricated product).

**gotain.com (one of the 5 owner stores, non-Shopify) was handled the
same way as any other miss**: `fetchNewProducts("https://gotain.com")`
tried `/products.json`, got no usable feed, fell back to the sitemap
check, found nothing usable there either, and returned
`not_enough_data` with no products and no fabricated dates. This only
affects the owner's own "new products" signal (which the current spike
doesn't use anyway — findings are built from competitors, not the
owner) — gotain.com's 3 picked competitors (halfpricedrapes.com,
curtarra.com, selectblinds.com) are all on Shopify and all returned real
dates, so the moves step for that store still had real findings to cite
despite the owner's own store being non-Shopify.

## Choice

Keep `/products.json` + sitemap fallback as the only product source for
Phase 0/1. An 80% hit rate with zero fabricated dates among the hits is
strong enough that a paid product-tracking service isn't justified yet.
No change made to `products-shopify.ts` — the existing fallback-to-
"not enough data" behavior is the correct, guardrails-compliant response
to the 20% miss rate, not a bug to fix.

## Open risk

A store that genuinely isn't on Shopify (gotain.com here, and
presumably some fraction of real cold-outreach targets) gets no "new
products" signal for itself — only for whichever competitors do happen
to be on Shopify. This is already visible as "not enough data" rather
than hidden, so it's a coverage gap to flag to Jordan, not a correctness
bug: Phase 1 should decide whether a non-Shopify-detection step (so the
owner sees "we couldn't check your own new products" explicitly in the
report) is worth adding, or whether this is acceptable given the signal
is about competitors anyway.

## Cost

\$0 — `/products.json` and sitemap requests are free, unauthenticated
HTTP calls through the existing SSRF-safe fetch module. No paid
product-tracking service used or proposed here.
