import type { Finding, Severity } from "../types.js";
import { createFinding } from "../findings/tracker.js";
import {
  changedLinesFromPatch,
  readFileSafe,
  type ChangedFile,
} from "../diff/files.js";

interface RuleMatch {
  ruleId: string;
  severity: Severity;
  category: Finding["category"];
  title: string;
  message: string;
  recommendation: string;
  line: number;
  resource?: string;
}

type RuleFn = (content: string, file: string) => RuleMatch[];

function lineOf(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

function resourceNear(content: string, index: number): string | undefined {
  const before = content.slice(0, index);
  const matches = [...before.matchAll(/resource\s+"([^"]+)"\s+"([^"]+)"/g)];
  const last = matches.at(-1);
  return last ? `${last[1]}.${last[2]}` : undefined;
}

const RULES: RuleFn[] = [
  (content, file) => {
    const out: RuleMatch[] = [];
    // Scan ingress blocks specifically to avoid egress 0.0.0.0/0 false positives
    for (const block of content.matchAll(
      /ingress\s*(?:\{|\s*=\s*\[?\s*\{)([\s\S]*?)(?:\n\s*\}|\])/g
    )) {
      const body = block[1];
      const idx = (block.index ?? 0) + block.indexOf(body);
      if (!/0\.0\.0\.0\/0/.test(body)) continue;
      const ssh =
        /from_port\s*=\s*22/.test(body) ||
        /to_port\s*=\s*22/.test(body) ||
        /from_port\s*=\s*3389/.test(body) ||
        /to_port\s*=\s*3389/.test(body);
      out.push({
        ruleId: ssh ? "AWS_SG_PUBLIC_SSH" : "AWS_SG_OPEN_CIDR",
        severity: ssh ? "critical" : "high",
        category: "security",
        title: ssh ? "Public SSH/RDP security group" : "Security group open to the world",
        message: ssh
          ? "This rule allows inbound SSH/RDP from 0.0.0.0/0."
          : "Inbound traffic is allowed from 0.0.0.0/0.",
        recommendation: ssh
          ? 'Restrict SSH access to a trusted CIDR or use AWS SSM instead of exposing SSH publicly.\n\nExample:\n```hcl\ncidr_blocks = ["10.0.0.0/8"]\n```'
          : "Limit CIDR blocks to known networks. Prefer security group references over public CIDRs.",
        line: lineOf(content, idx),
        resource: resourceNear(content, idx),
      });
      void file;
    }
    // Also catch standalone aws_security_group_rule resources
    for (const m of content.matchAll(
      /resource\s+"aws_security_group_rule"\s+"([^"]+)"\s*\{([\s\S]*?)(?:\n\}\n|\n\}\s*$)/g
    )) {
      const body = m[2];
      if (!/type\s*=\s*"ingress"/.test(body) || !/0\.0\.0\.0\/0/.test(body)) continue;
      const ssh = /from_port\s*=\s*22/.test(body) || /from_port\s*=\s*3389/.test(body);
      out.push({
        ruleId: ssh ? "AWS_SG_PUBLIC_SSH" : "AWS_SG_OPEN_CIDR",
        severity: ssh ? "critical" : "high",
        category: "security",
        title: ssh ? "Public SSH/RDP security group" : "Security group open to the world",
        message: ssh
          ? "This rule allows inbound SSH/RDP from 0.0.0.0/0."
          : "Inbound traffic is allowed from 0.0.0.0/0.",
        recommendation:
          "Restrict CIDRs to trusted networks or use AWS SSM / private connectivity.",
        line: lineOf(content, m.index ?? 0),
        resource: `aws_security_group_rule.${m[1]}`,
      });
    }
    return out;
  },
  (content) => {
    const out: RuleMatch[] = [];
    for (const m of content.matchAll(
      /resource\s+"aws_s3_bucket_public_access_block"\s+"([^"]+)"\s*\{([\s\S]*?)\}/g
    )) {
      const body = m[2];
      const falseFlags = [
        "block_public_acls",
        "block_public_policy",
        "ignore_public_acls",
        "restrict_public_buckets",
      ].filter((k) => new RegExp(`${k}\\s*=\\s*false`).test(body));
      if (falseFlags.length) {
        out.push({
          ruleId: "AWS_S3_PUBLIC_ACCESS",
          severity: "high",
          category: "security",
          title: "S3 public access block weakened",
          message: `Public access block disables: ${falseFlags.join(", ")}.`,
          recommendation: "Keep all public access block settings set to true unless the bucket must be public.",
          line: lineOf(content, m.index ?? 0),
          resource: `aws_s3_bucket_public_access_block.${m[1]}`,
        });
      }
    }
    // ACL public-read
    for (const m of content.matchAll(/acl\s*=\s*"(public-read|public-read-write)"/g)) {
      out.push({
        ruleId: "AWS_S3_PUBLIC_ACL",
        severity: "critical",
        category: "security",
        title: "S3 bucket ACL is public",
        message: `Bucket ACL set to "${m[1]}".`,
        recommendation: "Use private ACL and CloudFront/OAC for public content delivery.",
        line: lineOf(content, m.index ?? 0),
        resource: resourceNear(content, m.index ?? 0),
      });
    }
    return out;
  },
  (content) => {
    const out: RuleMatch[] = [];
    for (const m of content.matchAll(
      /resource\s+"aws_db_instance"\s+"([^"]+)"\s*\{([\s\S]*?)(?:\n\}\n|\n\}\s*$)/g
    )) {
      const body = m[2];
      const line = lineOf(content, m.index ?? 0);
      const addr = `aws_db_instance.${m[1]}`;
      if (/publicly_accessible\s*=\s*true/.test(body)) {
        out.push({
          ruleId: "AWS_RDS_PUBLIC",
          severity: "critical",
          category: "security",
          title: "RDS instance is publicly accessible",
          message: `${addr} sets publicly_accessible = true.`,
          recommendation: "Set publicly_accessible = false and access via private networking/VPN/bastion/SSM.",
          line,
          resource: addr,
        });
      }
      if (/storage_encrypted\s*=\s*false/.test(body) || !/storage_encrypted\s*=/.test(body)) {
        out.push({
          ruleId: "AWS_RDS_UNENCRYPTED",
          severity: "high",
          category: "security",
          title: "RDS storage encryption missing/disabled",
          message: `${addr} does not clearly enable storage_encrypted = true.`,
          recommendation: "Set storage_encrypted = true and manage KMS keys intentionally.",
          line,
          resource: addr,
        });
      }
      if (/skip_final_snapshot\s*=\s*true/.test(body)) {
        out.push({
          ruleId: "AWS_RDS_SKIP_SNAPSHOT",
          severity: "medium",
          category: "reliability",
          title: "RDS skips final snapshot",
          message: `${addr} sets skip_final_snapshot = true.`,
          recommendation: "Prefer final snapshots for production databases.",
          line,
          resource: addr,
        });
      }
    }
    return out;
  },
  (content) => {
    const out: RuleMatch[] = [];
    for (const m of content.matchAll(
      /resource\s+"aws_iam_policy_document"\s+"([^"]+)"\s*\{([\s\S]*?)(?:\n\}\n|\n\}\s*$)/g
    )) {
      if (/\*\s*"?\s*Action\s*=\s*\["?\*"?\]|"Action"\s*:\s*"\*"|actions\s*=\s*\["\*"\]/i.test(m[2]) ||
          /actions\s*=\s*\["\*"\]/.test(m[2])) {
        out.push({
          ruleId: "AWS_IAM_STAR_ACTION",
          severity: "high",
          category: "security",
          title: "IAM policy allows all actions",
          message: `aws_iam_policy_document.${m[1]} includes Action = ["*"].`,
          recommendation: "Scope actions to the minimum required set.",
          line: lineOf(content, m.index ?? 0),
          resource: `aws_iam_policy_document.${m[1]}`,
        });
      }
    }
    for (const m of content.matchAll(/Action\s*=\s*\["\*"\]/g)) {
      out.push({
        ruleId: "AWS_IAM_STAR_ACTION",
        severity: "high",
        category: "security",
        title: "IAM policy allows all actions",
        message: 'Policy statement uses Action = ["*"].',
        recommendation: "Scope actions to the minimum required set.",
        line: lineOf(content, m.index ?? 0),
        resource: resourceNear(content, m.index ?? 0),
      });
    }
    for (const m of content.matchAll(/Principal\s*=\s*\{\s*AWS\s*=\s*"\*"\s*\}/g)) {
      out.push({
        ruleId: "AWS_IAM_STAR_PRINCIPAL",
        severity: "critical",
        category: "security",
        title: "IAM principal is wildcard",
        message: 'Trust/resource policy uses Principal AWS = "*".',
        recommendation: "Restrict principals to specific accounts/roles.",
        line: lineOf(content, m.index ?? 0),
        resource: resourceNear(content, m.index ?? 0),
      });
    }
    return out;
  },
  (content) => {
    const out: RuleMatch[] = [];
    for (const m of content.matchAll(
      /resource\s+"aws_ebs_volume"\s+"([^"]+)"\s*\{([\s\S]*?)(?:\n\}\n|\n\}\s*$)/g
    )) {
      if (!/encrypted\s*=\s*true/.test(m[2])) {
        out.push({
          ruleId: "AWS_EBS_UNENCRYPTED",
          severity: "high",
          category: "security",
          title: "EBS volume may be unencrypted",
          message: `aws_ebs_volume.${m[1]} does not set encrypted = true.`,
          recommendation: "Enable EBS encryption with a customer-managed or AWS-managed KMS key.",
          line: lineOf(content, m.index ?? 0),
          resource: `aws_ebs_volume.${m[1]}`,
        });
      }
    }
    return out;
  },
  (content) => {
    const out: RuleMatch[] = [];
    for (const m of content.matchAll(
      /(password|secret|access_key|secret_key)\s*=\s*"[^$][^"]+"/gi
    )) {
      out.push({
        ruleId: "TF_HARDCODED_SECRET",
        severity: "critical",
        category: "security",
        title: "Possible hardcoded secret",
        message: `Literal value assigned to sensitive-looking attribute \`${m[1]}\`.`,
        recommendation: "Use variables marked sensitive, Secrets Manager, SSM Parameter Store, or CI secrets.",
        line: lineOf(content, m.index ?? 0),
        resource: resourceNear(content, m.index ?? 0),
      });
    }
    return out;
  },
  (content) => {
    const out: RuleMatch[] = [];
    if (/provider\s+"aws"\s*\{[\s\S]*?region\s*=\s*"[^"]+"/.test(content) === false) {
      // not always an issue
    }
    for (const m of content.matchAll(/enable_deletion_protection\s*=\s*false/g)) {
      out.push({
        ruleId: "AWS_NO_DELETION_PROTECTION",
        severity: "medium",
        category: "reliability",
        title: "Deletion protection disabled",
        message: "enable_deletion_protection is false.",
        recommendation: "Enable deletion protection for production stateful resources.",
        line: lineOf(content, m.index ?? 0),
        resource: resourceNear(content, m.index ?? 0),
      });
    }
    return out;
  },
];

export function scanTerraformFiles(
  cwd: string,
  files: ChangedFile[],
  options?: { onlyChangedLines?: boolean }
): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    const content = readFileSafe(cwd, file.path);
    if (!content) continue;
    const changed = options?.onlyChangedLines
      ? changedLinesFromPatch(file.patch)
      : null;

    for (const rule of RULES) {
      for (const match of rule(content, file.path)) {
        if (changed && changed.size > 0 && !changed.has(match.line)) {
          // Still include high-signal criticals near changed hunks (±3)
          const near = [...changed].some((l) => Math.abs(l - match.line) <= 3);
          if (!near && match.severity !== "critical") continue;
          if (!near && match.severity === "critical") {
            // keep criticals in touched files
            if (![...changed].some((l) => Math.abs(l - match.line) <= 40)) continue;
          }
        }
        findings.push(
          createFinding({
            ruleId: match.ruleId,
            severity: match.severity,
            category: match.category,
            title: match.title,
            message: match.message,
            recommendation: match.recommendation,
            file: file.path,
            line: match.line,
            resource: match.resource,
          })
        );
      }
    }
  }
  return dedupe(findings);
}

function dedupe(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    if (seen.has(f.fingerprint)) return false;
    seen.add(f.fingerprint);
    return true;
  });
}
