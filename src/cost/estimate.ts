import type { CostEstimate, Finding, PlanSummary, Severity } from "../types.js";
import { createFinding } from "../findings/tracker.js";

type CostLineItem = CostEstimate["items"][number];

/** Approximate us-east-1 on-demand USD / month (730h). Heuristic — not a billing quote. */
const EC2_MONTHLY: Record<string, number> = {
  "t2.micro": 8,
  "t2.small": 17,
  "t2.medium": 34,
  "t3.micro": 8,
  "t3.small": 15,
  "t3.medium": 30,
  "t3.large": 60,
  "t3.xlarge": 121,
  "t3.2xlarge": 242,
  "t3a.medium": 27,
  "t3a.large": 54,
  "m5.large": 70,
  "m5.xlarge": 140,
  "m5.2xlarge": 280,
  "m6i.large": 70,
  "m6i.xlarge": 140,
  "c5.large": 62,
  "c5.xlarge": 124,
  "c6i.large": 62,
  "r5.large": 92,
  "r5.xlarge": 184,
  "r6g.large": 74,
  "r6g.xlarge": 148,
  "r6i.large": 92,
};

const RDS_MONTHLY: Record<string, number> = {
  "db.t3.micro": 15,
  "db.t3.small": 29,
  "db.t3.medium": 58,
  "db.t3.large": 117,
  "db.t4g.micro": 12,
  "db.t4g.small": 24,
  "db.t4g.medium": 48,
  "db.m5.large": 125,
  "db.m5.xlarge": 250,
  "db.m6g.large": 105,
  "db.r5.large": 175,
  "db.r5.xlarge": 350,
  "db.r6g.large": 148,
  "db.r6g.xlarge": 296,
  "db.r6i.large": 175,
};

const FIXED_MONTHLY: Record<string, number> = {
  aws_nat_gateway: 32,
  aws_eip: 4,
  aws_lb: 22,
  aws_alb: 22,
  aws_lb_listener: 0,
  aws_elb: 18,
  aws_efs_file_system: 6,
  aws_opensearch_domain: 80,
  aws_elasticsearch_domain: 80,
  aws_msk_cluster: 150,
  aws_eks_cluster: 73,
  aws_ecs_cluster: 0,
  aws_redshift_cluster: 200,
  aws_elasticache_replication_group: 50,
  aws_elasticache_cluster: 25,
  aws_vpn_gateway: 36,
  aws_customer_gateway: 0,
  aws_cloudfront_distribution: 10,
};

export function emptyCostEstimate(currency = "USD"): CostEstimate {
  return {
    enabled: false,
    currency,
    monthlyDeltaUsd: 0,
    monthlyBeforeUsd: 0,
    monthlyAfterUsd: 0,
    items: [],
    disclaimer:
      "Estimates are approximate on-demand list prices (us-east-1 style) and exclude data transfer, storage growth, and discounts.",
  };
}

export function analyzeCost(
  plan: PlanSummary,
  options: { enabled: boolean; currency?: string }
): { estimate: CostEstimate; findings: Finding[] } {
  const currency = options.currency ?? "USD";
  if (!options.enabled) {
    return { estimate: emptyCostEstimate(currency), findings: [] };
  }

  const estimate = emptyCostEstimate(currency);
  estimate.enabled = true;

  if (!plan.rawAvailable) {
    estimate.items.push({
      address: "(no plan)",
      type: "meta",
      action: "info",
      detail:
        "No Terraform plan JSON provided — cost delta requires `plan-file` / `terraform show -json`.",
      monthlyDeltaUsd: 0,
      confidence: "qualitative",
    });
    return {
      estimate,
      findings: [
        createFinding({
          ruleId: "COST_NO_PLAN",
          severity: "info",
          category: "cost",
          title: "Cost estimate unavailable",
          message:
            "Pass a Terraform plan JSON to estimate monthly cost impact of creates/resizes/destroys.",
          recommendation:
            "Add `terraform show -json tfplan > tfplan.json` and set `plan-file` on the Action.",
        }),
      ],
    };
  }

  for (const r of plan.resources) {
    const items = lineItemsForResource(r);
    for (const item of items) {
      estimate.items.push(item);
      if (item.confidence === "estimated") {
        estimate.monthlyDeltaUsd += item.monthlyDeltaUsd;
        if (item.monthlyDeltaUsd > 0) estimate.monthlyAfterUsd += item.monthlyDeltaUsd;
        if (item.monthlyDeltaUsd < 0) estimate.monthlyBeforeUsd += Math.abs(item.monthlyDeltaUsd);
      }
    }
  }

  estimate.monthlyDeltaUsd = round2(estimate.monthlyDeltaUsd);
  estimate.monthlyBeforeUsd = round2(estimate.monthlyBeforeUsd);
  estimate.monthlyAfterUsd = round2(estimate.monthlyAfterUsd);

  return { estimate, findings: findingsFromEstimate(estimate) };
}

function lineItemsForResource(r: {
  address: string;
  type: string;
  action: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}): CostLineItem[] {
  const items: CostLineItem[] = [];

  if (r.type === "aws_instance") {
    const before = priceEc2(String(r.before?.instance_type ?? ""));
    const after = priceEc2(String(r.after?.instance_type ?? ""));
    if (r.action === "create" && after != null) {
      items.push(item(r, `New EC2 ${r.after?.instance_type}`, after));
    } else if (r.action === "delete" && before != null) {
      items.push(item(r, `Remove EC2 ${r.before?.instance_type}`, -before));
    } else if ((r.action === "update" || r.action === "replace") && before != null && after != null) {
      const delta = after - before;
      if (delta !== 0) {
        items.push(
          item(
            r,
            `EC2 type ${r.before?.instance_type} → ${r.after?.instance_type}`,
            delta
          )
        );
      }
    }
    return items;
  }

  if (r.type === "aws_db_instance") {
    const before = priceRds(String(r.before?.instance_class ?? ""));
    const after = priceRds(String(r.after?.instance_class ?? ""));
    const storageBefore = Number(r.before?.allocated_storage ?? 0) * 0.115;
    const storageAfter = Number(r.after?.allocated_storage ?? 0) * 0.115;
    if (r.action === "create" && after != null) {
      items.push(
        item(r, `New RDS ${r.after?.instance_class}`, after + (storageAfter || 0))
      );
    } else if (r.action === "delete" && before != null) {
      items.push(item(r, `Remove RDS ${r.before?.instance_class}`, -(before + storageBefore)));
    } else if ((r.action === "update" || r.action === "replace") && (before != null || after != null)) {
      const b = (before ?? 0) + storageBefore;
      const a = (after ?? 0) + storageAfter;
      const delta = a - b;
      if (Math.abs(delta) >= 1) {
        items.push(
          item(
            r,
            `RDS ${r.before?.instance_class ?? "?"} → ${r.after?.instance_class ?? "?"} (incl. storage heuristic)`,
            delta
          )
        );
      }
    }
    return items;
  }

  if (r.type === "aws_eks_node_group" || r.type === "aws_autoscaling_group") {
    const beforeDesired = Number(
      r.before?.desired_size ?? r.before?.desired_capacity ?? r.before?.min_size ?? 0
    );
    const afterDesired = Number(
      r.after?.desired_size ?? r.after?.desired_capacity ?? r.after?.min_size ?? 0
    );
    const instanceType = String(
      (r.after?.instance_types as string[] | undefined)?.[0] ??
        r.after?.instance_type ??
        (r.before?.instance_types as string[] | undefined)?.[0] ??
        "m5.large"
    );
    const unit = priceEc2(instanceType) ?? 70;
    if (r.action === "create") {
      const n = afterDesired || 1;
      items.push(item(r, `New ${r.type} (~${n}× ${instanceType})`, unit * n));
    } else if (r.action === "delete") {
      const n = beforeDesired || 1;
      items.push(item(r, `Remove ${r.type}`, -unit * n));
    } else if (afterDesired !== beforeDesired) {
      items.push(
        item(
          r,
          `Scale ${beforeDesired} → ${afterDesired} (${instanceType})`,
          (afterDesired - beforeDesired) * unit
        )
      );
    }
    return items;
  }

  const fixed = FIXED_MONTHLY[r.type];
  if (fixed != null && fixed > 0) {
    if (r.action === "create" || r.action === "replace") {
      items.push(item(r, `New ${r.type}`, fixed));
    } else if (r.action === "delete") {
      items.push(item(r, `Remove ${r.type}`, -fixed));
    }
    return items;
  }

  // Qualitative expensive creates without a price row
  if (
    (r.action === "create" || r.action === "replace") &&
    /aws_(rds_|db_|redshift_|msk_|opensearch_|nat_|eks_|elasticache_)/.test(r.type)
  ) {
    items.push({
      address: r.address,
      type: r.type,
      action: r.action,
      detail: `Potentially costly resource created: ${r.type}`,
      monthlyDeltaUsd: 0,
      confidence: "qualitative",
    });
  }

  return items;
}

function findingsFromEstimate(estimate: CostEstimate): Finding[] {
  const findings: Finding[] = [];
  const priced = estimate.items.filter((i) => i.confidence === "estimated" && i.monthlyDeltaUsd !== 0);

  for (const i of priced) {
    findings.push(
      createFinding({
        ruleId: i.monthlyDeltaUsd > 0 ? "COST_INCREASE" : "COST_DECREASE",
        severity: severityForDelta(i.monthlyDeltaUsd),
        category: "cost",
        title:
          i.monthlyDeltaUsd > 0
            ? `Estimated cost increase: ${fmtMoney(i.monthlyDeltaUsd, estimate.currency)}/month`
            : `Estimated cost decrease: ${fmtMoney(Math.abs(i.monthlyDeltaUsd), estimate.currency)}/month`,
        message: `${i.detail}\n\nEstimated monthly delta: **${fmtMoney(i.monthlyDeltaUsd, estimate.currency)}/month**`,
        recommendation:
          i.monthlyDeltaUsd > 0
            ? "Confirm sizing is required. Consider Savings Plans / Reserved Instances for steady workloads, or right-size after load testing."
            : "Verify the downsize still meets performance and HA requirements.",
        resource: i.address,
      })
    );
  }

  for (const i of estimate.items.filter((x) => x.confidence === "qualitative" && x.address !== "(no plan)")) {
    findings.push(
      createFinding({
        ruleId: "COST_QUALITATIVE",
        severity: "low",
        category: "cost",
        title: "Potential cost impact",
        message: i.detail,
        recommendation: "Review AWS pricing for this resource family before merge.",
        resource: i.address,
      })
    );
  }

  if (Math.abs(estimate.monthlyDeltaUsd) >= 1) {
    findings.unshift(
      createFinding({
        ruleId: "COST_TOTAL_DELTA",
        severity: severityForDelta(estimate.monthlyDeltaUsd),
        category: "cost",
        title: `Net estimated monthly delta: ${fmtMoney(estimate.monthlyDeltaUsd, estimate.currency)}`,
        message: [
          `Approximate net change: **${fmtMoney(estimate.monthlyDeltaUsd, estimate.currency)}/month**`,
          "",
          estimate.disclaimer,
        ].join("\n"),
        recommendation:
          "Treat as a directional estimate only. Validate with AWS Cost Explorer / Infracost for production budgets.",
      })
    );
  }

  return findings;
}

function item(
  r: { address: string; type: string; action: string },
  detail: string,
  monthlyDeltaUsd: number
): CostLineItem {
  return {
    address: r.address,
    type: r.type,
    action: r.action,
    detail,
    monthlyDeltaUsd: round2(monthlyDeltaUsd),
    confidence: "estimated",
  };
}

function priceEc2(type: string): number | null {
  if (!type) return null;
  return EC2_MONTHLY[type] ?? null;
}

function priceRds(cls: string): number | null {
  if (!cls) return null;
  return RDS_MONTHLY[cls] ?? null;
}

function severityForDelta(delta: number): Severity {
  const abs = Math.abs(delta);
  if (delta <= -50) return "info";
  if (delta >= 200) return "high";
  if (delta >= 50) return "medium";
  if (abs >= 10) return "low";
  return "info";
}

export function fmtMoney(amount: number, currency = "USD"): string {
  const sign = amount > 0 ? "+" : amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  if (currency === "USD") return `${sign}$${abs.toFixed(0)}`;
  return `${sign}${abs.toFixed(0)} ${currency}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
