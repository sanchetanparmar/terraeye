#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config/schema.js";
import { analyzePullRequest } from "./analyze.js";
import {
  listLocalTerraformFiles,
  type ChangedFile,
} from "./diff/files.js";
import { formatSummaryComment } from "./report/format.js";
import { toReviewState } from "./findings/tracker.js";
import type { ReviewState } from "./types.js";

function usage(): never {
  console.log(`TerraEye — Terraform AI PR reviewer (local/CLI mode)

Usage:
  terraeye review [options]

Options:
  --cwd <path>           Working directory (default: .)
  --config <path>        Config file path
  --plan <path>          Terraform plan JSON (terraform show -json)
  --commit <sha>         Commit SHA label (default: local)
  --state <path>         Previous review state JSON (for incremental dedupe)
  --out <path>           Write markdown report to file
  --json <path>          Write machine-readable JSON result
`);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (!args.length || args[0] === "-h" || args[0] === "--help") usage();
  const cmd = args[0];
  if (cmd !== "review") usage();

  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const cwd = resolve(get("--cwd") ?? process.cwd());
  const config = loadConfig(cwd, get("--config") ? resolve(get("--config")!) : undefined);
  const plan = get("--plan");
  if (plan) config.plan_file = resolve(plan);

  const paths = listLocalTerraformFiles(cwd, config.paths);
  const files: ChangedFile[] = paths.map((path) => ({
    path,
    status: "modified",
  }));

  let previousState: ReviewState | undefined;
  const statePath = get("--state");
  if (statePath && existsSync(resolve(cwd, statePath))) {
    previousState = JSON.parse(
      readFileSync(resolve(cwd, statePath), "utf8")
    ) as ReviewState;
  }

  const commitSha = get("--commit") ?? "local";
  const result = await analyzePullRequest({
    cwd,
    config,
    files,
    commitSha,
    previousState,
    incremental: Boolean(previousState),
    planFile: config.plan_file,
  });

  const state = toReviewState(result.findings, commitSha);
  const markdown = formatSummaryComment(result, config, state);
  console.log(markdown);

  const out = get("--out");
  if (out) writeFileSync(resolve(cwd, out), markdown, "utf8");

  const jsonOut = get("--json");
  if (jsonOut) {
    writeFileSync(
      resolve(cwd, jsonOut),
      JSON.stringify({ result, state }, null, 2),
      "utf8"
    );
  }

  if (statePath) {
    writeFileSync(resolve(cwd, statePath), JSON.stringify(state, null, 2));
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
