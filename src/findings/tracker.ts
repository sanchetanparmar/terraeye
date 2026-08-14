import { createHash } from "node:crypto";
import type { Finding, ReviewState, Severity } from "../types.js";

export function fingerprintFinding(input: {
  ruleId: string;
  file?: string;
  line?: number;
  resource?: string;
}): string {
  const key = [
    input.ruleId,
    input.file ?? "",
    String(input.line ?? ""),
    input.resource ?? "",
  ].join("|");
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export function createFinding(
  partial: Omit<Finding, "fingerprint" | "status" | "id"> & {
    status?: Finding["status"];
    id?: string;
  }
): Finding {
  const fingerprint = fingerprintFinding({
    ruleId: partial.ruleId,
    file: partial.file,
    line: partial.line,
    resource: partial.resource,
  });
  return {
    ...partial,
    id: partial.id ?? fingerprint,
    fingerprint,
    status: partial.status ?? "new",
  };
}

export function reconcileFindings(
  current: Finding[],
  previous?: ReviewState
): Finding[] {
  if (!previous?.findings?.length) {
    return current.map((f) => ({ ...f, status: "new" as const }));
  }

  const prevByFp = new Map(previous.findings.map((f) => [f.fingerprint, f]));
  const currentFps = new Set(current.map((f) => f.fingerprint));

  const reconciled: Finding[] = current.map((finding) => {
    const prev = prevByFp.get(finding.fingerprint);
    if (!prev) {
      return { ...finding, status: "new" as const };
    }
    return {
      ...finding,
      status: "persistent" as const,
      commentId: prev.commentId ?? finding.commentId,
    };
  });

  for (const prev of previous.findings) {
    if (currentFps.has(prev.fingerprint)) continue;
    if (prev.status === "resolved") continue;
    reconciled.push({
      id: prev.fingerprint,
      ruleId: prev.ruleId,
      severity: prev.severity as Severity,
      category: "best_practice",
      title: `Resolved: ${prev.ruleId}`,
      message: "This finding was fixed in a later commit.",
      file: prev.file,
      line: prev.line,
      fingerprint: prev.fingerprint,
      commentId: prev.commentId,
      status: "resolved",
    });
  }

  return reconciled;
}

export function toReviewState(
  findings: Finding[],
  commitSha: string,
  summaryCommentId?: number
): ReviewState {
  return {
    version: 1,
    lastCommitSha: commitSha,
    summaryCommentId,
    findings: findings
      .filter((f) => f.status !== "resolved")
      .map((f) => ({
        fingerprint: f.fingerprint,
        ruleId: f.ruleId,
        file: f.file,
        line: f.line,
        severity: f.severity,
        commentId: f.commentId,
        status: f.status === "resolved" ? "resolved" : f.status,
      })),
    updatedAt: new Date().toISOString(),
  };
}

export function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const f of findings) {
    if (f.status === "resolved" || f.status === "suppressed") continue;
    counts[f.severity] += 1;
  }
  return counts;
}

export function findingsNeedingInlineComments(
  findings: Finding[],
  minSeverity: Severity
): Finding[] {
  const order: Severity[] = ["critical", "high", "medium", "low", "info"];
  const minIdx = order.indexOf(minSeverity);
  return findings.filter((f) => {
    if (f.status !== "new") return false;
    if (!f.file || f.line == null) return false;
    return order.indexOf(f.severity) <= minIdx;
  });
}
