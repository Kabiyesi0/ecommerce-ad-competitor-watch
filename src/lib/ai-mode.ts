/**
 * Single source of truth for whether this process may reach Claude at
 * all. Default is off — free mode (see docs/decisions/007-free-mode.md)
 * is the product now; the AI pipeline (search, moves, grounding) stays
 * in the codebase but requires an explicit opt-in to run. Every
 * construction of an Anthropic client, and every raw call to it, checks
 * this first.
 */
export class AiModeDisabledError extends Error {
  constructor(where: string) {
    super(
      `AI_MODE is off — refusing to construct/call the Anthropic client from ${where}. ` +
        "Set AI_MODE=on in .env.local to use the AI pipeline (requires ANTHROPIC_API_KEY). " +
        "Never set AI_MODE or ANTHROPIC_API_KEY in a deployed environment.",
    );
    this.name = "AiModeDisabledError";
  }
}

/** Strict allow-list, not a truthy check — unset, blank, "off", "false", a typo all mean disabled. Fails safe. */
export function isAiModeEnabled(): boolean {
  return process.env.AI_MODE === "on";
}

/** Call as the first line of any function about to construct an Anthropic client or call it. */
export function assertAiModeEnabled(where: string): void {
  if (!isAiModeEnabled()) {
    throw new AiModeDisabledError(where);
  }
}
