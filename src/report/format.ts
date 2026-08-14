import type { Finding, ReviewResult, ReviewState } from "../types.js";
import { RISK_EMOJI, SEVERITY_EMOJI } from "../types.js";
import { countBySeverity } from "../findings/tracker.js";
import type { TerraeyeConfig } from "../config/schema.js";

const STATE_START = "<!-- terraeye-state:";
const STATE_END = ":terraeye-state -->";

export function encodeState(state: ReviewState): string {
  const json = Buffer.from(JSON.stringify(state), "utf8").toString("base64");
  return `${STATE_START}${json}${STATE_END}`;
}

export function decodeState(body: string): ReviewState | undefined {
  const start = body.indexOf(STATE_START);
  if (start < 0) return undefined;
  const from = start + STATE_START.length;
  const end = body.indexOf(STATE_END, from);
  if (end < 0) return undefined;
  try {
    const json = Buffer.from(body.slice(from, end), "base64").toString("utf8");
    return JSON.parse(json) as ReviewState;
  } catch {
    return undefined;
  }
}

export function formatSummaryComment(
  result: ReviewResult,
  config: TerraeyeConfig,
  state: ReviewState
): string {
  const active = result.findings.filter(
    (f) => f.status !== "resolved" && f.status !== "suppressed"
  );
  const resolved = result.findings.filter((f) => f.status === "resolved");
  const counts = countBySeverity(result.findings);
  const { plan, risk } = result;

  const security = section(
    "🔐 SECURITY",
    active.filter((f) => f.category === "security")
  );
  const bugs = section(
    "⚠️ POTENTIAL BUGS",
    active.filter((f) => f.category === "bug" || f.category === "reliability")
  );
  const cost = section(
    "💰 COST",
    active.filter((f) => f.category === "cost")
  );

  const recommendation =
    result.aiSummary ??
    (counts.critical + counts.high > 0
      ? "⚠️ Review high-severity security and destructive plan changes before merging."
      : "✅ No critical/high issues detected. Spot-check medium findings and plan summary.");

  const details = [
    "### Active findings",
    ...active.slice(0, 30).map(formatFindingBullet),
    resolved.length
      ? `\n### Resolved since last review\n${resolved
          .map((f) => `- ✅ \`${f.ruleId}\` ${f.file ? `(${f.file}:${f.line})` : ""}`)
          .join("\n")}`
      : "",
    risk.factors.length ? `\n### Risk factors\n${risk.factors.map((f) => `- ${f}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const collapsed = config.comment.collapse_details
    ? `<details>\n<summary>View detailed analysis</summary>\n\n${details}\n\n</details>`
    : details;

  return [
    config.comment.marker,
    encodeState(state),
    "",
    "🤖 **Terraform AI Review**",
    "",
    "Terraform changes detected and analyzed.",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━",
    "📊 SUMMARY",
    "━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "Resources:",
    `  🟢 Create:   ${plan.add}`,
    `  🟡 Modify:   ${plan.change}`,
    `  🔴 Destroy:  ${plan.destroy}`,
    plan.replace ? `  ♻️ Replace:  ${plan.replace}` : null,
    "",
    `Risk Score: ${risk.score}/100`,
    `Risk Level: ${RISK_EMOJI[risk.level]} ${risk.level.toUpperCase()}`,
    `Security Score: ${risk.securityScore}/100`,
    result.cost.enabled && Math.abs(result.cost.monthlyDeltaUsd) >= 1
      ? `Cost delta (est.): ${result.cost.monthlyDeltaUsd > 0 ? "+" : ""}$${result.cost.monthlyDeltaUsd.toFixed(0)}/month`
      : result.cost.enabled
        ? "Cost delta (est.): ~$0/month (or needs plan JSON)"
        : null,
    "",
    `Findings: 🔴 ${counts.critical} critical · 🟠 ${counts.high} high · 🟡 ${counts.medium} medium · 🔵 ${counts.low} low · ℹ️ ${counts.info} info`,
    resolved.length ? `Resolved this run: ${resolved.length}` : null,
    "",
    security,
    bugs,
    cost,
    "━━━━━━━━━━━━━━━━━━━━━━",
    "📋 TERRAFORM PLAN",
    "━━━━━━━━━━━━━━━━━━━━━━",
    "",
    plan.rawAvailable
      ? `${plan.add} to add  ·  ${plan.change} to change  ·  ${plan.destroy} to destroy`
      : "_No plan JSON provided — static analysis only. Pass `plan_file` for full plan review._",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━",
    "🤖 RECOMMENDATION",
    "━━━━━━━━━━━━━━━━━━━━━━",
    "",
    recommendation,
    "",
    collapsed,
    "",
    `Reviewed commit: \`${result.commitSha.slice(0, 7)}\``,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

function section(title: string, findings: Finding[]): string {
  if (!findings.length) return "";
  const lines = [
    "━━━━━━━━━━━━━━━━━━━━━━",
    title,
    "━━━━━━━━━━━━━━━━━━━━━━",
    "",
  ];
  for (const f of findings.slice(0, 8)) {
    lines.push(`${SEVERITY_EMOJI[f.severity]} **${f.severity.toUpperCase()}**${f.resource ? ` \`${f.resource}\`` : ""}`);
    lines.push("");
    lines.push(f.message);
    if (f.recommendation) {
      lines.push("");
      lines.push("Recommendation:");
      lines.push(f.recommendation);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function formatFindingBullet(f: Finding): string {
  const loc = f.file ? ` \`${f.file}${f.line ? `:${f.line}` : ""}\`` : "";
  return `- ${SEVERITY_EMOJI[f.severity]} **${f.ruleId}**${loc} — ${f.title}`;
}

export function formatInlineBody(f: Finding): string {
  return [
    `${SEVERITY_EMOJI[f.severity]} **${f.severity.toUpperCase()}** — ${f.title}`,
    "",
    f.message,
    f.recommendation ? `\nRecommended:\n\n${f.recommendation}` : "",
    "",
    `<!-- terraeye-finding:${f.fingerprint} -->`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatCheckSummary(result: ReviewResult): string {
  const counts = countBySeverity(result.findings);
  const fail =
    counts.critical + counts.high > 0
      ? "❌ Changes require attention"
      : "✅ No high-severity issues";
  return [
    "Terraform AI Review",
    "",
    fail,
    "",
    `Critical:  ${counts.critical}`,
    `High:      ${counts.high}`,
    `Medium:    ${counts.medium}`,
    `Low:       ${counts.low}`,
    "",
    `Security Score: ${result.risk.securityScore}/100`,
    `Risk Score:     ${result.risk.score}/100`,
    result.cost.enabled
      ? `Cost delta:      ${result.cost.monthlyDeltaUsd > 0 ? "+" : ""}$${result.cost.monthlyDeltaUsd.toFixed(0)}/mo`
      : null,
    "",
    "Terraform Plan:",
    `+${result.plan.add}  ~${result.plan.change}  -${result.plan.destroy}`,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

export function formatCheckTitle(result: ReviewResult): string {
  const counts = countBySeverity(result.findings);
  if (counts.critical + counts.high > 0) return "Changes require attention";
  if (counts.medium > 0) return "Changes look mostly safe";
  return "No issues found";
}
