import { spawnSync } from "node:child_process";
import type { Finding, Severity } from "../types.js";
import { createFinding } from "../findings/tracker.js";

function mapSeverity(raw: string): Severity {
  const s = raw.toLowerCase();
  if (s === "critical") return "critical";
  if (s === "high") return "high";
  if (s === "medium" || s === "moderate" || s === "warning") return "medium";
  if (s === "low") return "low";
  return "info";
}

export function runCheckov(cwd: string, enabled: boolean): Finding[] {
  if (!enabled) return [];
  const result = spawnSync(
    "checkov",
    ["-d", ".", "--framework", "terraform", "-o", "json", "--quiet"],
    { cwd, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }
  );
  if (result.status !== 0 && !result.stdout) return [];
  try {
    const parsed = JSON.parse(result.stdout) as {
      results?: {
        failed_checks?: Array<{
          check_id: string;
          check_name: string;
          severity?: string;
          file_path?: string;
          file_line_range?: number[];
          resource?: string;
          guideline?: string;
        }>;
      };
    };
    return (parsed.results?.failed_checks ?? []).map((c) =>
      createFinding({
        ruleId: `CHECKOV_${c.check_id}`,
        severity: mapSeverity(c.severity ?? "medium"),
        category: "security",
        title: c.check_name,
        message: c.check_name,
        recommendation: c.guideline,
        file: c.file_path?.replace(/^\//, ""),
        line: c.file_line_range?.[0],
        resource: c.resource,
      })
    );
  } catch {
    return [];
  }
}

export function runTfLint(cwd: string, enabled: boolean): Finding[] {
  if (!enabled) return [];
  const result = spawnSync("tflint", ["-f", "json"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (!result.stdout) return [];
  try {
    const parsed = JSON.parse(result.stdout) as {
      issues?: Array<{
        rule: { name: string; severity: string };
        message: string;
        range?: { filename: string; start: { line: number } };
      }>;
    };
    return (parsed.issues ?? []).map((i) =>
      createFinding({
        ruleId: `TFLINT_${i.rule.name}`,
        severity: mapSeverity(i.rule.severity),
        category: "best_practice",
        title: i.rule.name,
        message: i.message,
        file: i.range?.filename,
        line: i.range?.start.line,
      })
    );
  } catch {
    return [];
  }
}

export function runTrivy(cwd: string, enabled: boolean): Finding[] {
  if (!enabled) return [];
  const result = spawnSync(
    "trivy",
    ["config", ".", "--format", "json", "--quiet"],
    { cwd, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }
  );
  if (!result.stdout) return [];
  try {
    const parsed = JSON.parse(result.stdout) as {
      Results?: Array<{
        Misconfigurations?: Array<{
          ID: string;
          Title: string;
          Description: string;
          Severity: string;
          CauseMetadata?: { Resource?: string; StartLine?: number };
        }>;
        Target?: string;
      }>;
    };
    const findings: Finding[] = [];
    for (const r of parsed.Results ?? []) {
      for (const m of r.Misconfigurations ?? []) {
        findings.push(
          createFinding({
            ruleId: `TRIVY_${m.ID}`,
            severity: mapSeverity(m.Severity),
            category: "security",
            title: m.Title,
            message: m.Description,
            file: r.Target,
            line: m.CauseMetadata?.StartLine,
            resource: m.CauseMetadata?.Resource,
          })
        );
      }
    }
    return findings;
  } catch {
    return [];
  }
}
