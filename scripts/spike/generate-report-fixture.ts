import { buildReportFixture, writeReportFixture } from "./build-report.js";
import { closeAdLibraryBrowser } from "./ads.js";
import { GLOBAL_MAX_RUN_COST_USD } from "../../src/lib/cost-guard.js";

function parseArgs(argv: string[]): { store: string } {
  const storeIndex = argv.indexOf("--store");
  const store = storeIndex >= 0 ? argv[storeIndex + 1] : undefined;
  if (!store) {
    throw new Error("Usage: npm run generate-report-fixture -- --store <url>");
  }
  return { store };
}

async function main() {
  const { store: storeUrl } = parseArgs(process.argv.slice(2));
  console.log(`Building report for ${storeUrl} (max run cost $${GLOBAL_MAX_RUN_COST_USD}) ...`);
  const { fixture, costUsd, durationMs } = await buildReportFixture(storeUrl);
  writeReportFixture(fixture);

  console.log(`\nDone. Fixture written to app-prototype/fixtures/${fixture.domain}.json`);
  console.log(`Run cost: $${costUsd.toFixed(4)}`);
  console.log(`Total run time: ${Math.round(durationMs)}ms`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeAdLibraryBrowser();
    // Belt-and-braces: some open handle (HTTP keep-alive, a Playwright
    // internal connection) otherwise leaves the process hanging after
    // all real work is done and logged.
    process.exit(process.exitCode ?? 0);
  });
