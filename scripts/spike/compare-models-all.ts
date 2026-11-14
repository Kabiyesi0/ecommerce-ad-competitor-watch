import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

/**
 * Loops compare-models.ts over the 5-store golden set for Phase 0. Store
 * URLs come either from --stores-file <path> (one URL per line, blank
 * lines and lines starting with # ignored) or from repeated --store <url>
 * flags. Each store runs as its own child process so a failure on one
 * store (e.g. a site that blocks bots) doesn't stop the rest.
 */
function parseArgs(argv: string[]): { stores: string[] } {
  const storesFileIndex = argv.indexOf("--stores-file");
  if (storesFileIndex >= 0) {
    const path = argv[storesFileIndex + 1];
    if (!path) throw new Error("--stores-file requires a path");
    const lines = readFileSync(path, "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    return { stores: lines };
  }

  const stores: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--store" && argv[i + 1]) {
      stores.push(argv[i + 1]!);
    }
  }
  if (stores.length === 0) {
    throw new Error(
      "Usage: npm run compare-models:all -- --stores-file spike-results/stores.txt\n" +
        "   or: npm run compare-models:all -- --store <url> --store <url> ...",
    );
  }
  return { stores };
}

function main() {
  const { stores } = parseArgs(process.argv.slice(2));
  console.log(`Running model comparison for ${stores.length} store(s)...\n`);

  const failures: string[] = [];
  for (const store of stores) {
    console.log(`=== ${store} ===`);
    const result = spawnSync(
      "npx",
      ["tsx", "--env-file=.env.local", "scripts/spike/compare-models.ts", "--store", store],
      { stdio: "inherit" },
    );
    if (result.status !== 0) {
      console.warn(`  -> FAILED for ${store}, continuing with the rest`);
      failures.push(store);
    }
    console.log("");
  }

  console.log(`Done. ${stores.length - failures.length}/${stores.length} stores succeeded.`);
  if (failures.length > 0) {
    console.log(`Failed: ${failures.join(", ")}`);
    process.exitCode = 1;
  }
}

main();
