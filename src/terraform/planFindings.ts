import type { Finding, PlanSummary } from "../types.js";
import { createFinding } from "../findings/tracker.js";

/** Findings derived from terraform plan resource actions. */
export function analyzePlan(plan: PlanSummary): Finding[] {
  if (!plan.rawAvailable) return [];
  const findings: Finding[] = [];

  for (const r of plan.resources) {
    if (r.action === "replace") {
      const isDb =
        r.type.includes("db_instance") ||
        r.type.includes("rds") ||
        r.type === "aws_elasticache_cluster";
      findings.push(
        createFinding({
          ruleId: "TFPLAN_REPLACE",
          severity: isDb ? "high" : "medium",
          category: "bug",
          title: `Resource will be replaced: ${r.address}`,
          message: `Terraform plans to destroy and recreate \`${r.address}\`.${
            r.replacePaths?.length
              ? ` Force-new attributes: ${r.replacePaths.join(", ")}.`
              : ""
          }`,
          recommendation: isDb
            ? "Confirm backups, migration strategy, and acceptable downtime before merge."
            : "Confirm replacement impact (downtime, recreation cost, dependent resources).",
          resource: r.address,
        })
      );
    }

    if (r.action === "delete") {
      const sensitive =
        /aws_(db_instance|rds_|s3_bucket|kms_key|iam_user|iam_role|eks_cluster)/.test(
          r.type
        );
      findings.push(
        createFinding({
          ruleId: "TFPLAN_DESTROY",
          severity: sensitive ? "high" : "medium",
          category: "bug",
          title: `Resource will be destroyed: ${r.address}`,
          message: `Plan destroys \`${r.address}\` (${r.type}).`,
          recommendation: "Verify this deletion is intentional and data is backed up.",
          resource: r.address,
        })
      );
    }

    if (r.type === "aws_security_group" || r.type === "aws_security_group_rule") {
      const after = r.after ?? {};
      const ingress = (after.ingress as unknown[]) ?? [];
      if (hasOpenSsh(ingress) || hasOpenCidr(after)) {
        findings.push(
          createFinding({
            ruleId: "TFPLAN_OPEN_SG",
            severity: "high",
            category: "security",
            title: `Public exposure in plan: ${r.address}`,
            message: "Plan after-state appears to allow broad network access (0.0.0.0/0).",
            recommendation:
              "Restrict CIDRs to trusted networks or use AWS SSM / private connectivity.",
            resource: r.address,
          })
        );
      }
    }
  }

  if (plan.destroy > 0 && plan.destroy >= 5) {
    findings.push(
      createFinding({
        ruleId: "TFPLAN_MASS_DESTROY",
        severity: "high",
        category: "plan",
        title: "Large number of destroys",
        message: `Plan destroys ${plan.destroy} resources.`,
        recommendation: "Double-check workspace/state targeting before apply.",
      })
    );
  }

  return findings;
}

function hasOpenCidr(after: Record<string, unknown>): boolean {
  const cidrs = after.cidr_blocks;
  if (Array.isArray(cidrs) && cidrs.includes("0.0.0.0/0")) return true;
  return false;
}

function hasOpenSsh(ingress: unknown[]): boolean {
  for (const rule of ingress) {
    if (!rule || typeof rule !== "object") continue;
    const r = rule as Record<string, unknown>;
    const from = Number(r.from_port ?? 0);
    const to = Number(r.to_port ?? 0);
    const cidrs = (r.cidr_blocks as string[]) ?? [];
    if (cidrs.includes("0.0.0.0/0") && from <= 22 && to >= 22) return true;
  }
  return false;
}
