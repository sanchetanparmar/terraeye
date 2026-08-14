export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type FindingCategory =
  | "security"
  | "bug"
  | "cost"
  | "reliability"
  | "best_practice"
  | "plan";

export interface Finding {
  id: string;
  ruleId: string;
  severity: Severity;
  category: FindingCategory;
  title: string;
  message: string;
  recommendation?: string;
  file?: string;
  line?: number;
  endLine?: number;
  resource?: string;
  fingerprint: string;
  /** GitHub review comment ID when an inline comment exists */
  commentId?: number;
  /** Whether this finding was present in a previous review */
  status: "new" | "persistent" | "resolved" | "suppressed";
}

export interface PlanSummary {
  add: number;
  change: number;
  destroy: number;
  replace: number;
  resources: PlanResourceChange[];
  rawAvailable: boolean;
}

export interface PlanResourceChange {
  address: string;
  type: string;
  name: string;
  action: "create" | "update" | "delete" | "replace" | "read" | "no-op";
  replacePaths?: string[];
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

export interface RiskResult {
  score: number;
  level: "low" | "medium" | "high" | "critical";
  securityScore: number;
  factors: string[];
}

export interface ReviewState {
  version: 1;
  lastCommitSha: string;
  summaryCommentId?: number;
  findings: Array<{
    fingerprint: string;
    ruleId: string;
    file?: string;
    line?: number;
    severity: Severity;
    commentId?: number;
    status: Finding["status"];
  }>;
  updatedAt: string;
}

export interface ReviewResult {
  findings: Finding[];
  plan: PlanSummary;
  risk: RiskResult;
  previousState?: ReviewState;
  commitSha: string;
  aiSummary?: string;
}

export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export const SEVERITY_EMOJI: Record<Severity, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🔵",
  info: "ℹ️",
};

export const RISK_EMOJI: Record<RiskResult["level"], string> = {
  low: "🟢",
  medium: "🟡",
  high: "🟠",
  critical: "🔴",
};
