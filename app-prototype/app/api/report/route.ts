import { NextResponse } from "next/server";
import { buildReportFixture } from "../../../../scripts/spike/build-report.js";
import { assertAiModeEnabled, AiModeDisabledError } from "../../../../src/lib/ai-mode.js";

// Local use only: runs the AI pipeline (classify -> search -> pick ->
// ads+products -> moves) against a live store, under the same global
// spend caps as the CLI (src/lib/cost-guard.ts's GLOBAL_MAX_RUN_COST_USD
// / GLOBAL_MAX_DAILY_COST_USD, shared by every script and this route).
// Dormant behind AI_MODE (see docs/decisions/007-free-mode.md) — the
// app's default flow is free mode, served by /api/free-report, which
// never imports this route or anything it depends on. Never deployed:
// requires AI_MODE=on and ANTHROPIC_API_KEY set locally. NEVER set
// either of those in a deployed (e.g. Vercel) environment.
export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const url = (body as { url?: unknown })?.url;
  if (typeof url !== "string" || !url.trim()) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  let storeUrl: string;
  try {
    storeUrl = url.startsWith("http") ? url : `https://${url}`;
    new URL(storeUrl);
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }

  try {
    assertAiModeEnabled("api/report route");
  } catch (err) {
    if (err instanceof AiModeDisabledError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set on the server running this app." },
      { status: 500 },
    );
  }

  try {
    const { fixture, costUsd, durationMs } = await buildReportFixture(storeUrl);
    return NextResponse.json({ fixture, costUsd, durationMs });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error building the report" },
      { status: 500 },
    );
  }
}
