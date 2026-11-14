import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CostGuard,
  DailyCostCapExceededError,
  RunCostCapExceededError,
} from "../../src/lib/cost-guard.js";

describe("CostGuard", () => {
  let dir: string;
  let dailySpendPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cost-guard-test-"));
    dailySpendPath = join(dir, "daily-spend.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("allows calls within both caps and records real spend", () => {
    const guard = new CostGuard(1, 10, dailySpendPath);
    guard.checkBeforeCall(0.01);
    guard.recordActualSpend(0.01);
    expect(guard.runTotalSoFarUsd()).toBeCloseTo(0.01);
  });

  it("aborts mid-sequence once the per-run cap would be exceeded", () => {
    const guard = new CostGuard(0.02, 10, dailySpendPath);
    guard.checkBeforeCall(0.01);
    guard.recordActualSpend(0.01);
    guard.checkBeforeCall(0.01);
    guard.recordActualSpend(0.01);
    expect(() => guard.checkBeforeCall(0.01)).toThrow(RunCostCapExceededError);
  });

  it("refuses a new call once the per-day cap would be exceeded, even across guard instances", () => {
    const first = new CostGuard(10, 0.02, dailySpendPath);
    first.checkBeforeCall(0.02);
    first.recordActualSpend(0.02);

    // A fresh run (new CostGuard instance, e.g. the next CLI invocation)
    // reads the same persisted daily file and must still be blocked.
    const second = new CostGuard(10, 0.02, dailySpendPath);
    expect(() => second.checkBeforeCall(0.001)).toThrow(DailyCostCapExceededError);
  });

  it("never charges for a call it declined to make", () => {
    const guard = new CostGuard(0.01, 10, dailySpendPath);
    expect(() => guard.checkBeforeCall(0.02)).toThrow(RunCostCapExceededError);
    expect(guard.runTotalSoFarUsd()).toBe(0);
    // Nothing was ever written, so there's no daily-spend file to reflect
    // a charge either.
    expect(() => readFileSync(dailySpendPath)).toThrow();
  });
});
