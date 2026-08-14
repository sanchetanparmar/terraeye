import type { TerraeyeConfig } from "./config/schema.js";
import { filterTerraformFiles, type ChangedFile } from "./diff/files.js";
import { reconcileFindings } from "./findings/tracker.js";
import { scanTerraformFiles } from "./scanners/builtin.js";
import { runCheckov, runTfLint, runTrivy } from "./scanners/external.js";
import { loadPlanFile } from "./terraform/plan.js";
import { analyzePlan } from "./terraform/planFindings.js";
import { computeRisk, costFindings } from "./risk/engine.js";
import { generateAiSummary } from "./ai/summary.js";
import type { Finding, ReviewResult, ReviewState } from "./types.js";

export interface AnalyzeOptions {
  cwd: string;
  config: TerraeyeConfig;
  files: ChangedFile[];
  commitSha: string;
  previousState?: ReviewState;
  /** When true, focus builtin rules on changed lines (PR synchronize). */
  incremental?: boolean;
  planFile?: string;
}

export async function analyzePullRequest(
  options: AnalyzeOptions
): Promise<ReviewResult> {
  const { cwd, config, commitSha, previousState } = options;
  const tfFiles = filterTerraformFiles(options.files, config);

  const plan = loadPlanFile(options.planFile ?? config.plan_file);

  const findings: Finding[] = [];

  if (config.scanners.builtin) {
    findings.push(
      ...scanTerraformFiles(cwd, tfFiles, {
        onlyChangedLines: options.incremental === true,
      })
    );
  }

  findings.push(...analyzePlan(plan));
  findings.push(...costFindings(plan, config.cost.enabled));

  if (config.scanners.checkov) findings.push(...runCheckov(cwd, true));
  if (config.scanners.tflint) findings.push(...runTfLint(cwd, true));
  if (config.scanners.trivy) findings.push(...runTrivy(cwd, true));

  const reconciled = reconcileFindings(dedupeByFingerprint(findings), previousState);
  const risk = computeRisk(reconciled, plan);
  const aiSummary = await generateAiSummary(
    { findings: reconciled, plan, risk, commitSha },
    config
  );

  return {
    findings: reconciled,
    plan,
    risk,
    previousState,
    commitSha,
    aiSummary,
  };
}

function dedupeByFingerprint(findings: Finding[]): Finding[] {
  const map = new Map<string, Finding>();
  for (const f of findings) {
    const existing = map.get(f.fingerprint);
    if (!existing) {
      map.set(f.fingerprint, f);
      continue;
    }
    // Prefer higher severity / richer location
    const order = ["info", "low", "medium", "high", "critical"];
    if (order.indexOf(f.severity) > order.indexOf(existing.severity)) {
      map.set(f.fingerprint, f);
    }
  }
  return [...map.values()];
}
