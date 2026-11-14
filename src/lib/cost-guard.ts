import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * One cap, shared by every script and by live mode — no script, CLI
 * flag, or API route defines its own. Any call that would exceed either
 * number aborts before it's made.
 */
export const GLOBAL_MAX_RUN_COST_USD = 0.1;
export const GLOBAL_MAX_DAILY_COST_USD = 1;

export class RunCostCapExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunCostCapExceededError";
  }
}

export class DailyCostCapExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DailyCostCapExceededError";
  }
}

interface DailySpendFile {
  date: string; // YYYY-MM-DD
  totalUsd: number;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Enforces hard spend caps during the Phase 0 spike / model comparison,
 * before any persistent DB exists. Phase 2 swaps the daily-spend tracker
 * for a real DB-backed one (see docs/decisions/004); this file's job is
 * just to make sure nothing here can run up an unbounded bill in the
 * meantime.
 */
export class CostGuard {
  private readonly dailySpendPath: string;
  private runTotalUsd = 0;

  constructor(
    private readonly maxRunCostUsd: number,
    private readonly maxDailyCostUsd: number,
    dailySpendPath = "spike-results/daily-spend.json",
  ) {
    this.dailySpendPath = dailySpendPath;
  }

  private readDailySpend(): DailySpendFile {
    if (!existsSync(this.dailySpendPath)) {
      return { date: todayUtc(), totalUsd: 0 };
    }
    try {
      const parsed = JSON.parse(readFileSync(this.dailySpendPath, "utf-8")) as DailySpendFile;
      if (parsed.date !== todayUtc()) return { date: todayUtc(), totalUsd: 0 };
      return parsed;
    } catch {
      return { date: todayUtc(), totalUsd: 0 };
    }
  }

  private writeDailySpend(state: DailySpendFile): void {
    const dir = dirname(this.dailySpendPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.dailySpendPath, JSON.stringify(state));
  }

  /**
   * Call BEFORE making a model/paid call that would cost `estimatedUsd`.
   * Throws without making any call if either cap would be exceeded — a
   * refused call must never be charged for, so this always runs first.
   */
  checkBeforeCall(estimatedUsd: number): void {
    if (this.runTotalUsd + estimatedUsd > this.maxRunCostUsd) {
      throw new RunCostCapExceededError(
        `Per-run cost cap of $${this.maxRunCostUsd} would be exceeded (current: $${this.runTotalUsd.toFixed(4)}, next call: ~$${estimatedUsd.toFixed(4)})`,
      );
    }
    const daily = this.readDailySpend();
    if (daily.totalUsd + estimatedUsd > this.maxDailyCostUsd) {
      throw new DailyCostCapExceededError(
        `Per-day cost cap of $${this.maxDailyCostUsd} would be exceeded (today so far: $${daily.totalUsd.toFixed(4)}, next call: ~$${estimatedUsd.toFixed(4)})`,
      );
    }
  }

  /** Call AFTER a call actually completes, with its real measured cost. */
  recordActualSpend(actualUsd: number): void {
    this.runTotalUsd += actualUsd;
    const daily = this.readDailySpend();
    daily.totalUsd += actualUsd;
    this.writeDailySpend(daily);
  }

  runTotalSoFarUsd(): number {
    return this.runTotalUsd;
  }
}
