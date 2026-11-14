import { readFileSync } from "node:fs";

interface Row {
  storeUrl: string;
  step: string;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  durationMs: number;
}

function parseCsv(path: string): Row[] {
  const lines = readFileSync(path, "utf-8").trim().split("\n");
  const [, ...dataLines] = lines; // skip header
  return dataLines.map((line) => {
    const [storeUrl, step, calls, tokensIn, tokensOut, costUsd, durationMs] = line.split(",");
    return {
      storeUrl: storeUrl ?? "",
      step: step ?? "",
      calls: Number(calls ?? 0),
      tokensIn: Number(tokensIn ?? 0),
      tokensOut: Number(tokensOut ?? 0),
      costUsd: Number(costUsd ?? 0),
      durationMs: Number(durationMs ?? 0),
    };
  });
}

function main() {
  const path = process.argv[2] ?? "spike-results/cost-log.csv";
  const rows = parseCsv(path);

  const byStep = new Map<string, { calls: number; costUsd: number }>();
  for (const row of rows) {
    const existing = byStep.get(row.step) ?? { calls: 0, costUsd: 0 };
    existing.calls += row.calls;
    existing.costUsd += row.costUsd;
    byStep.set(row.step, existing);
  }

  const storeCount = new Set(rows.map((r) => r.storeUrl)).size || 1;
  const totalCost = rows.reduce((sum, r) => sum + r.costUsd, 0);

  console.log("| Step | Calls per run | Cost per run |");
  console.log("|------|---------------|--------------|");
  for (const [step, { calls, costUsd }] of byStep) {
    console.log(
      `| ${step} | ${(calls / storeCount).toFixed(1)} | $${(costUsd / storeCount).toFixed(4)} |`,
    );
  }
  console.log(`| **Total** | | **$${(totalCost / storeCount).toFixed(4)}** |`);
  console.log(`\n(${storeCount} store run(s) measured)`);
}

main();
