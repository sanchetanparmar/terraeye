import type { Finding, PlanSummary, RiskResult } from "../types.js";

const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 25,
  high: 15,
  medium: 8,
  low: 3,
  info: 1,
};

export function computeRisk(findings: Finding[], plan: PlanSummary): RiskResult {
  const active = findings.filter(
    (f) => f.status !== "resolved" && f.status !== "suppressed"
  );
  let score = 0;
  const factors: string[] = [];

  for (const f of active) {
    score += SEVERITY_WEIGHT[f.severity] ?? 1;
  }

  score += plan.destroy * 4;
  score += plan.replace * 6;
  score += Math.min(plan.add, 20);

  if (plan.replace > 0) factors.push(`${plan.replace} resource replacement(s)`);
  if (plan.destroy > 0) factors.push(`${plan.destroy} destroy(s)`);
  const criticals = active.filter((f) => f.severity === "critical").length;
  const highs = active.filter((f) => f.severity === "high").length;
  if (criticals) factors.push(`${criticals} critical finding(s)`);
  if (highs) factors.push(`${highs} high finding(s)`);

  const costHigh = active.filter(
    (f) => f.category === "cost" && (f.severity === "high" || f.severity === "medium")
  ).length;
  if (costHigh) factors.push(`${costHigh} material cost finding(s)`);

  score = Math.min(100, Math.round(score));

  let level: RiskResult["level"] = "low";
  if (score >= 80 || criticals > 0) level = "critical";
  else if (score >= 55 || highs >= 2) level = "high";
  else if (score >= 30 || highs >= 1) level = "medium";

  const securityFindings = active.filter((f) => f.category === "security");
  const securityPenalty = securityFindings.reduce(
    (sum, f) => sum + (SEVERITY_WEIGHT[f.severity] ?? 1),
    0
  );
  const securityScore = Math.max(0, 100 - Math.min(100, securityPenalty * 2));

  return { score, level, securityScore, factors };
}
