import Anthropic from "@anthropic-ai/sdk";
import type { CostLog } from "./cost-log.js";
import { assertAiModeEnabled } from "../../src/lib/ai-mode.js";

const SEARCH_MODEL = "claude-haiku-4-5";

/**
 * One shared search step per store, used as input to ALL THREE
 * ModelClients when picking competitors (see pick-competitors.ts) — this
 * keeps the model comparison fair by holding the search data constant
 * and varying only the reasoning model, and sidesteps needing web-search
 * tool parity across providers (GLM/Cerebras don't have Claude's hosted
 * web_search tool).
 *
 * Search-source choice: Claude's hosted web_search tool is used here
 * rather than a separate paid/free search API (Brave Search, DuckDuckGo
 * HTML) because it needs no new account beyond the Anthropic key already
 * in use. Confirm at run time whether web_search calls are metered
 * separately from the message itself under the API plan in use — if so,
 * log that cost explicitly (done below) rather than assuming it's free,
 * and revisit this choice in docs/decisions/001-model-provider-choice.md
 * if it turns out to be the more expensive option.
 */
export async function searchCandidates(
  storeUrl: string,
  category: string,
  productKeywords: string[],
  client: Anthropic,
  costLog?: CostLog,
): Promise<string> {
  // See docs/decisions/007-free-mode.md. This function takes a raw
  // Anthropic client (needed for the hosted web_search tool), bypassing
  // ModelClient's own gate, so it needs its own independent check.
  assertAiModeEnabled("searchCandidates");
  const start = performance.now();
  const message = await client.messages.create({
    model: SEARCH_MODEL,
    max_tokens: 1024,
    system:
      "Search the web for real, currently-operating e-commerce storefronts " +
      "comparable to the one described. Reject marketplaces (Amazon, Etsy), " +
      "directories, blogs and review sites. After searching, summarize up to " +
      "8 candidate storefronts you found as plain text: one line per " +
      "candidate, domain followed by a short note on why it's comparable.",
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }],
    messages: [
      {
        role: "user",
        content: `Store: ${storeUrl}
Category: ${category}
Sells: ${productKeywords.join(", ")}

Search for comparable storefronts and list up to 8 candidates as described.`,
      },
    ],
  });

  const webSearchRequests = message.usage.server_tool_use?.web_search_requests ?? 0;
  costLog?.record({
    storeUrl,
    step: "search_candidates",
    provider: "claude", // the shared search step always uses Claude's web_search tool
    calls: 1,
    tokensIn: message.usage.input_tokens,
    tokensOut: message.usage.output_tokens,
    costUsd:
      estimateCostUsd(message.usage.input_tokens, message.usage.output_tokens) +
      webSearchRequests * WEB_SEARCH_FEE_USD_PER_SEARCH,
    durationMs: performance.now() - start,
  });

  const textBlocks = message.content.filter((b) => b.type === "text");
  return textBlocks.map((b) => (b.type === "text" ? b.text : "")).join("\n");
}

// Claude token pricing — see src/llm/providers/claude.ts for the
// canonical constant and source; duplicated here narrowly because this
// file intentionally stays on the raw Anthropic SDK (for the web_search
// tool) rather than going through ModelClient, which doesn't model
// server-side tools.
function estimateCostUsd(tokensIn: number, tokensOut: number): number {
  const pricing = { input: 1.0, output: 5.0 };
  return (tokensIn / 1_000_000) * pricing.input + (tokensOut / 1_000_000) * pricing.output;
}

// Source: https://platform.claude.com/docs/en/about-claude/pricing
// ("Web search is available on the Claude API for $10 USD per 1,000
// searches ... a web search that fails with an error is not billed"),
// checked 2026-11-08. Search-result content is already billed as normal
// input tokens (counted above); this is the separate flat per-search fee.
const WEB_SEARCH_FEE_USD_PER_SEARCH = 10 / 1000;
