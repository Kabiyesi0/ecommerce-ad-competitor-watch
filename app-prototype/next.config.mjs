import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Live mode (local use only) needs ANTHROPIC_API_KEY to run the real
// pipeline. The key lives in the main project's .env.local, one level
// up — load it here rather than duplicating the secret into this
// sub-project's own env file.
const parentEnvPath = path.join(import.meta.dirname, "..", ".env.local");
if (existsSync(parentEnvPath)) {
  for (const line of readFileSync(parentEnvPath, "utf-8").split("\n")) {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (match && !(match[1] in process.env)) {
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
}

// `import.meta.dirname` (used by scripts/spike/*.ts to find the repo
// root when run standalone via tsx) does not survive webpack bundling —
// it comes out undefined inside the bundle. This file is loaded by
// Next's own config loader, not bundled, so import.meta.dirname is
// reliable right here; pass the real repo root through explicitly for
// the bundled code to fall back on.
process.env.COMPETITOR_WATCH_REPO_ROOT = path.join(import.meta.dirname, "..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: import.meta.dirname,
  },
  // Live mode's API route imports the real pipeline from ../scripts and
  // ../src, outside this directory — Next.js refuses to resolve imports
  // outside the project root unless this is set. Only webpack mode
  // (this project runs with --webpack; see package.json) respects it —
  // Turbopack does not yet.
  experimental: {
    externalDir: true,
  },
  // The real pipeline's own source files (outside this directory) use
  // NodeNext-style ".js"-extension imports that resolve to ".ts" files
  // under tsx/the main project's own tsconfig, but webpack doesn't
  // apply that remapping to externalDir'd sources on its own.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    // serverExternalPackages alone doesn't reliably externalize
    // playwright/playwright-core when the import chain passes through an
    // externalDir'd source file (scripts/spike/ads.ts, outside this
    // project) — webpack still tries to bundle playwright-core's own
    // internal coreBundle.js/utilsBundle.js, which contain dynamic
    // require() calls it can't resolve, crashing at runtime with
    // "Cannot find module .../.next/dev/server/package.json". Force
    // these external explicitly as a backstop.
    const existingExternals = Array.isArray(config.externals)
      ? config.externals
      : config.externals
        ? [config.externals]
        : [];
    config.externals = [
      ...existingExternals,
      ({ request }, callback) => {
        if (request && /^playwright(-core)?(\/|$)/.test(request)) {
          return callback(null, `commonjs ${request}`);
        }
        callback();
      },
    ];
    return config;
  },
  // playwright/sharp ship native binaries and optional deps (e.g.
  // "kerberos") that webpack can't bundle — load them via Node's own
  // require at runtime instead of trying to bundle them.
  serverExternalPackages: ["playwright", "playwright-core", "sharp"],
};

export default nextConfig;
