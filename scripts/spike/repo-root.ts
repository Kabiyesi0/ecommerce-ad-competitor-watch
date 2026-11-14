import path from "node:path";

/**
 * The repo root, resolved from this module's own location — not
 * process.cwd() — so file paths stay correct no matter where the
 * process was started from (a plain tsx CLI run, or the Next.js
 * live-mode API route, whose server cwd is app-prototype/).
 *
 * `import.meta.dirname` doesn't survive webpack bundling (it comes out
 * undefined inside the bundle), so COMPETITOR_WATCH_REPO_ROOT is set
 * explicitly by app-prototype/next.config.mjs — which is loaded by
 * Next's own config loader, not bundled, so import.meta.dirname is
 * reliable there — as a fallback for the bundled case.
 */
export const REPO_ROOT =
  process.env.COMPETITOR_WATCH_REPO_ROOT ?? path.resolve(import.meta.dirname, "../..");
