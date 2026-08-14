import { readFileSync, existsSync } from "node:fs";
import type { PlanResourceChange, PlanSummary } from "../types.js";

interface TfPlanJson {
  resource_changes?: Array<{
    address: string;
    type: string;
    name: string;
    change?: {
      actions?: string[];
      before?: Record<string, unknown> | null;
      after?: Record<string, unknown> | null;
      replace_paths?: unknown[];
    };
  }>;
}

function mapAction(actions: string[] = []): PlanResourceChange["action"] {
  if (actions.includes("create") && actions.includes("delete")) return "replace";
  if (actions.includes("create")) return "create";
  if (actions.includes("update")) return "update";
  if (actions.includes("delete")) return "delete";
  if (actions.includes("read")) return "read";
  return "no-op";
}

export function emptyPlan(): PlanSummary {
  return {
    add: 0,
    change: 0,
    destroy: 0,
    replace: 0,
    resources: [],
    rawAvailable: false,
  };
}

export function parsePlanJson(raw: string): PlanSummary {
  const plan = JSON.parse(raw) as TfPlanJson;
  const resources: PlanResourceChange[] = [];
  let add = 0;
  let change = 0;
  let destroy = 0;
  let replace = 0;

  for (const rc of plan.resource_changes ?? []) {
    const actions = rc.change?.actions ?? [];
    if (actions.length === 1 && actions[0] === "no-op") continue;
    const action = mapAction(actions);
    if (action === "create") add += 1;
    else if (action === "update") change += 1;
    else if (action === "delete") destroy += 1;
    else if (action === "replace") {
      replace += 1;
      add += 1;
      destroy += 1;
    }

    resources.push({
      address: rc.address,
      type: rc.type,
      name: rc.name,
      action,
      replacePaths: (rc.change?.replace_paths ?? []).map(String),
      before: rc.change?.before ?? null,
      after: rc.change?.after ?? null,
    });
  }

  return { add, change, destroy, replace, resources, rawAvailable: true };
}

export function loadPlanFile(path?: string): PlanSummary {
  if (!path || !existsSync(path)) return emptyPlan();
  return parsePlanJson(readFileSync(path, "utf8"));
}

/** Heuristic helpers kept for backward compatibility — prefer src/cost/estimate.ts */
export function estimateCostSignals(plan: PlanSummary): string[] {
  const signals: string[] = [];
  for (const r of plan.resources) {
    if (r.type === "aws_db_instance" && (r.action === "update" || r.action === "replace")) {
      const before = String(r.before?.instance_class ?? "");
      const after = String(r.after?.instance_class ?? "");
      if (before && after && before !== after) {
        signals.push(`RDS instance size change: ${before} → ${after} (${r.address})`);
      }
    }
    if (r.type === "aws_instance" && (r.action === "update" || r.action === "replace")) {
      const before = String(r.before?.instance_type ?? "");
      const after = String(r.after?.instance_type ?? "");
      if (before && after && before !== after) {
        signals.push(`EC2 instance type change: ${before} → ${after} (${r.address})`);
      }
    }
  }
  return signals;
}
