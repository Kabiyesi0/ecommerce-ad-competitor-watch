import { NextResponse } from "next/server";
import { buildFreeReportFixture } from "../../../../scripts/spike/build-free-report.js";
import { isDomainLike, toBareDomain } from "../../../lib/validate-url.js";

// The app's default flow (see docs/decisions/007-free-mode.md). This
// route, and everything it imports, never touches src/llm/* or
// @anthropic-ai/sdk — it is AI-free by construction, not just by a
// runtime flag check, so it needs no ANTHROPIC_API_KEY or AI_MODE check
// at all. Keep it that way: don't add an import here that reaches the
// AI pipeline (build-report.ts, classify-store.ts, search-candidates.ts,
// find-competitors.ts, compare-suggest-moves.ts, src/llm/*).
export const runtime = "nodejs";

const MAX_COMPETITORS = 3;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const storeUrlRaw = (body as { storeUrl?: unknown })?.storeUrl;
  const competitorUrlsRaw = (body as { competitorUrls?: unknown })?.competitorUrls;

  if (typeof storeUrlRaw !== "string" || !storeUrlRaw.trim()) {
    return NextResponse.json({ error: "Missing storeUrl" }, { status: 400 });
  }
  if (!isDomainLike(toBareDomain(storeUrlRaw))) {
    return NextResponse.json(
      { error: "That store web address doesn't look right." },
      { status: 400 },
    );
  }

  if (!Array.isArray(competitorUrlsRaw) || competitorUrlsRaw.length === 0) {
    return NextResponse.json(
      { error: "Enter at least 1 competitor web address." },
      { status: 400 },
    );
  }
  if (competitorUrlsRaw.length > MAX_COMPETITORS) {
    return NextResponse.json(
      { error: `Enter at most ${MAX_COMPETITORS} competitor web addresses.` },
      { status: 400 },
    );
  }
  const competitorUrls = competitorUrlsRaw.filter(
    (u): u is string => typeof u === "string" && u.trim().length > 0,
  );
  if (competitorUrls.length !== competitorUrlsRaw.length) {
    return NextResponse.json(
      { error: "Every competitor field must have a web address." },
      { status: 400 },
    );
  }
  for (const u of competitorUrls) {
    if (!isDomainLike(toBareDomain(u))) {
      return NextResponse.json(
        { error: `"${u}" doesn't look like a web address.` },
        { status: 400 },
      );
    }
  }
  const bareDomains = competitorUrls.map(toBareDomain);
  if (new Set(bareDomains).size !== bareDomains.length) {
    return NextResponse.json(
      { error: "Enter each competitor's web address only once." },
      { status: 400 },
    );
  }

  try {
    const { fixture, durationMs } = await buildFreeReportFixture(storeUrlRaw, competitorUrls);
    return NextResponse.json({ fixture, durationMs });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error building the report" },
      { status: 500 },
    );
  }
}
