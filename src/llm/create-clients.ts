import type { ModelClient } from "./model-client.js";
import { ClaudeModelClient } from "./providers/claude.js";
import { GlmModelClient } from "./providers/glm.js";
import { LlamaCerebrasModelClient } from "./providers/llama-cerebras.js";
import { assertAiModeEnabled } from "../lib/ai-mode.js";

export interface AllClients {
  claude: ModelClient;
  glm: ModelClient | null; // null if ZAI_API_KEY isn't set
  llamaCerebras: ModelClient | null; // null if CEREBRAS_API_KEY isn't set
}

export function createAllModelClients(): AllClients {
  // See docs/decisions/007-free-mode.md.
  assertAiModeEnabled("createAllModelClients");
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    throw new Error("ANTHROPIC_API_KEY is not set — check .env.local");
  }

  const zaiKey = process.env.ZAI_API_KEY;
  const cerebrasKey = process.env.CEREBRAS_API_KEY;

  return {
    claude: new ClaudeModelClient(anthropicKey),
    glm: zaiKey ? new GlmModelClient(zaiKey) : null,
    llamaCerebras: cerebrasKey ? new LlamaCerebrasModelClient(cerebrasKey) : null,
  };
}
