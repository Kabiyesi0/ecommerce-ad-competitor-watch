import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./repo-root.js";

// One-off transform (see docs/decisions/007-free-mode.md): derives
// app-prototype/fixtures-free/*.json from the existing AI-mode fixtures
// in app-prototype/fixtures/*.json, with moves stripped and whyPicked
// replaced by the same honest placeholder build-free-report.ts uses for
// real runs. Does not modify the originals, makes no network/API calls.
const SRC_DIR = path.join(REPO_ROOT, "app-prototype/fixtures");
const DEST_DIR = path.join(REPO_ROOT, "app-prototype/fixtures-free");

mkdirSync(DEST_DIR, { recursive: true });
for (const file of readdirSync(SRC_DIR).filter((f) => f.endsWith(".json"))) {
  const fixture = JSON.parse(readFileSync(path.join(SRC_DIR, file), "utf-8"));
  fixture.moves = [];
  fixture.movesDiagnostics = {
    groundedCount: 0,
    totalCount: 0,
    distinctCompetitorsCited: 0,
    diversityOk: false,
  };
  for (const c of fixture.competitors) {
    c.whyPicked = "You told us to check this one.";
  }
  writeFileSync(path.join(DEST_DIR, file), JSON.stringify(fixture, null, 2));
  console.log(`wrote ${path.join(DEST_DIR, file)}`);
}
