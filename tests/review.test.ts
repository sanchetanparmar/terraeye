import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parsePlanJson } from "../src/terraform/plan.js";
import { analyzePlan } from "../src/terraform/planFindings.js";
import { scanTerraformFiles } from "../src/scanners/builtin.js";
import { computeRisk } from "../src/risk/engine.js";
import {
  countBySeverity,
  fingerprintFinding,
  reconcileFindings,
  toReviewState,
} from "../src/findings/tracker.js";
import { decodeState, encodeState, formatSummaryComment } from "../src/report/format.js";
import { TerraeyeConfigSchema, shouldFailCheck } from "../src/config/schema.js";
import { analyzePullRequest } from "../src/analyze.js";

const fixtures = resolve(import.meta.dirname, "fixtures");

describe("plan parser", () => {
  it("counts add/change/destroy/replace", () => {
    const plan = parsePlanJson(readFileSync(resolve(fixtures, "plan.json"), "utf8"));
    expect(plan.add).toBe(2); // replace counts as add+destroy, plus create
    expect(plan.destroy).toBe(1);
    expect(plan.replace).toBe(1);
    expect(plan.change).toBe(1);
    expect(plan.rawAvailable).toBe(true);
  });

  it("emits replace and open SG findings", () => {
    const plan = parsePlanJson(readFileSync(resolve(fixtures, "plan.json"), "utf8"));
    const findings = analyzePlan(plan);
    expect(findings.some((f) => f.ruleId === "TFPLAN_REPLACE")).toBe(true);
    expect(findings.some((f) => f.ruleId === "TFPLAN_OPEN_SG")).toBe(true);
  });
});

describe("builtin scanner", () => {
  it("detects public SSH, RDS, secrets, and public S3", () => {
    const findings = scanTerraformFiles(resolve(fixtures, "insecure"), [
      { path: "main.tf", status: "modified" },
    ]);
    const ids = new Set(findings.map((f) => f.ruleId));
    expect(ids.has("AWS_SG_PUBLIC_SSH")).toBe(true);
    expect(ids.has("AWS_RDS_PUBLIC")).toBe(true);
    expect(ids.has("TF_HARDCODED_SECRET")).toBe(true);
    expect(ids.has("AWS_S3_PUBLIC_ACL")).toBe(true);
  });
});

describe("finding tracker", () => {
  it("fingerprints stably and reconciles resolved findings", () => {
    const fp = fingerprintFinding({
      ruleId: "AWS_SG_PUBLIC_SSH",
      file: "main.tf",
      line: 10,
      resource: "aws_security_group.app",
    });
    expect(fp).toHaveLength(16);

    const previous = toReviewState(
      [
        {
          id: fp,
          fingerprint: fp,
          ruleId: "AWS_SG_PUBLIC_SSH",
          severity: "critical",
          category: "security",
          title: "x",
          message: "x",
          file: "main.tf",
          line: 10,
          resource: "aws_security_group.app",
          status: "new",
          commentId: 99,
        },
      ],
      "abc"
    );

    const reconciled = reconcileFindings([], previous);
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0].status).toBe("resolved");
    expect(reconciled[0].commentId).toBe(99);
  });
});

describe("risk + fail_on", () => {
  it("scores high for critical findings", () => {
    const plan = parsePlanJson(readFileSync(resolve(fixtures, "plan.json"), "utf8"));
    const findings = analyzePlan(plan);
    const risk = computeRisk(findings, plan);
    expect(risk.score).toBeGreaterThan(30);
    expect(["medium", "high", "critical"]).toContain(risk.level);
  });

  it("respects fail_on none", () => {
    expect(shouldFailCheck("none", { critical: 1, high: 2 })).toBe(false);
    expect(shouldFailCheck(["critical"], { critical: 1, high: 2 })).toBe(true);
    expect(shouldFailCheck(["critical"], { critical: 0, high: 2 })).toBe(false);
  });
});

describe("report state round-trip", () => {
  it("encodes and decodes state inside comment body", () => {
    const state = toReviewState([], "deadbeef");
    const encoded = encodeState(state);
    const decoded = decodeState(`hello\n${encoded}\nworld`);
    expect(decoded?.lastCommitSha).toBe("deadbeef");
  });
});

describe("end-to-end analyze", () => {
  it("produces a TerraEye summary for insecure fixture", async () => {
    const config = TerraeyeConfigSchema.parse({
      ai: { enabled: false, provider: "none" },
      plan_file: resolve(fixtures, "plan.json"),
    });
    const result = await analyzePullRequest({
      cwd: resolve(fixtures, "insecure"),
      config,
      files: [{ path: "main.tf", status: "modified" }],
      commitSha: "abc1234",
    });
    const counts = countBySeverity(result.findings);
    expect(counts.critical + counts.high).toBeGreaterThan(0);

    const md = formatSummaryComment(
      result,
      config,
      toReviewState(result.findings, result.commitSha)
    );
    expect(md).toContain("Terraform AI Review");
    expect(md).toContain("SUMMARY");
    expect(md).toContain("SECURITY");
    expect(md).toContain("COST");
    expect(result.cost.enabled).toBe(true);
    // db.t3.medium → db.r6g.large should produce a positive monthly delta
    expect(result.cost.monthlyDeltaUsd).toBeGreaterThan(0);
  });
});

describe("cost estimator", () => {
  it("estimates RDS resize delta", async () => {
    const { analyzeCost } = await import("../src/cost/estimate.js");
    const plan = parsePlanJson(readFileSync(resolve(fixtures, "plan.json"), "utf8"));
    const { estimate, findings } = analyzeCost(plan, { enabled: true });
    expect(estimate.monthlyDeltaUsd).toBeGreaterThan(50);
    expect(findings.some((f) => f.ruleId === "COST_INCREASE" || f.ruleId === "COST_TOTAL_DELTA")).toBe(
      true
    );
  });
});
