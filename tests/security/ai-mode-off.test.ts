import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from "undici";
import { AiModeDisabledError } from "../../src/lib/ai-mode.js";
import { createAllModelClients } from "../../src/llm/create-clients.js";
import { ClaudeModelClient } from "../../src/llm/providers/claude.js";

/**
 * Proves AI_MODE=off (the default) makes Claude genuinely unreachable,
 * not just unused by convention. MockAgent.disableNetConnect() is the
 * real backstop here: it physically blocks every outbound request for
 * the duration of this test, so if any gate below is ever removed or
 * misordered, the test fails on a real blocked-network error, not just
 * a missed assertion. See docs/decisions/007-free-mode.md.
 */
describe("AI_MODE off blocks all Anthropic access", () => {
  let originalDispatcher: Dispatcher;
  let mockAgent: MockAgent;
  let originalAiMode: string | undefined;
  let originalApiKey: string | undefined;

  beforeEach(() => {
    originalDispatcher = getGlobalDispatcher();
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);

    originalAiMode = process.env.AI_MODE;
    originalApiKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.AI_MODE;
    delete process.env.ANTHROPIC_API_KEY; // prove this works with no key present at all
  });

  afterEach(async () => {
    await mockAgent.close();
    setGlobalDispatcher(originalDispatcher);
    if (originalAiMode === undefined) delete process.env.AI_MODE;
    else process.env.AI_MODE = originalAiMode;
    if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalApiKey;
  });

  it("createAllModelClients throws before constructing any Anthropic client", () => {
    expect(() => createAllModelClients()).toThrow(AiModeDisabledError);
  });

  it("ClaudeModelClient's own constructor refuses, even called directly", () => {
    expect(() => new ClaudeModelClient("fake-key")).toThrow(AiModeDisabledError);
  });

  it("buildReportFixture throws before any network attempt", async () => {
    const { buildReportFixture } = await import("../../scripts/spike/build-report.js");
    // The guard must fire before sampleSite/classifyStore ever run, so no
    // real domain (reachable or not) is actually touched here.
    await expect(buildReportFixture("https://example.com")).rejects.toThrow(AiModeDisabledError);
  });

  it("searchCandidates throws before calling messages.create", async () => {
    const { searchCandidates } = await import("../../scripts/spike/search-candidates.js");
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const fakeClient = new Anthropic({ apiKey: "fake" });
    await expect(searchCandidates("https://example.com", "test", [], fakeClient)).rejects.toThrow(
      AiModeDisabledError,
    );
  });

  it("build-free-report.ts never imports the Anthropic SDK or src/llm", () => {
    const src = readFileSync(
      path.join(import.meta.dirname, "../../scripts/spike/build-free-report.ts"),
      "utf-8",
    );
    const importLines = src.split("\n").filter((line) => /^\s*import\b/.test(line));
    expect(importLines.some((line) => /@anthropic-ai\/sdk/.test(line))).toBe(false);
    expect(importLines.some((line) => /src\/llm/.test(line))).toBe(false);
    expect(importLines.some((line) => /build-report\.js/.test(line))).toBe(false);
  });
});
