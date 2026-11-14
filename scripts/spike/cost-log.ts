import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface CostLogRow {
  storeUrl: string;
  step: string;
  /** Which model provider made this call, e.g. "claude" | "glm" | "llama-cerebras". */
  provider: string;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  durationMs: number;
  rateLimited?: boolean;
}

const CSV_HEADER =
  "store_url,step,provider,calls,tokens_in,tokens_out,cost_usd,duration_ms,rate_limited,timestamp\n";

export class CostLog {
  private readonly path: string;
  readonly rows: CostLogRow[] = [];

  constructor(path: string) {
    this.path = path;
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (!existsSync(path)) writeFileSync(path, CSV_HEADER);
  }

  record(row: CostLogRow): void {
    this.rows.push(row);
    const timestamp = new Date().toISOString();
    const line = [
      row.storeUrl,
      row.step,
      row.provider,
      row.calls,
      row.tokensIn,
      row.tokensOut,
      row.costUsd.toFixed(6),
      Math.round(row.durationMs),
      row.rateLimited ? "1" : "0",
      timestamp,
    ].join(",");
    appendFileSync(this.path, `${line}\n`);
  }

  totalCostUsd(): number {
    return this.rows.reduce((sum, r) => sum + r.costUsd, 0);
  }

  totalDurationMs(): number {
    return this.rows.reduce((sum, r) => sum + r.durationMs, 0);
  }
}
