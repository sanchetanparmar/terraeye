import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { load as loadYaml } from "js-yaml";
import { z } from "zod";

const FailOnSchema = z.union([
  z.literal("none"),
  z.array(z.enum(["critical", "high", "medium", "low", "info"])),
]);

const InlineCommentsSchema = z.object({
  enabled: z.boolean().default(true),
  min_severity: z
    .enum(["critical", "high", "medium", "low", "info"])
    .default("high"),
});

const AiSchema = z.object({
  enabled: z.boolean().default(true),
  provider: z.enum(["openai", "anthropic", "none"]).default("openai"),
  model: z.string().default("gpt-4o-mini"),
});

const CostSchema = z.object({
  enabled: z.boolean().default(true),
  currency: z.string().default("USD"),
});

const ScannersSchema = z.object({
  builtin: z.boolean().default(true),
  checkov: z.boolean().default(false),
  tflint: z.boolean().default(false),
  trivy: z.boolean().default(false),
});

const CommentSchema = z.object({
  marker: z.string().default("<!-- terraeye-review -->"),
  collapse_details: z.boolean().default(true),
});

const CheckSchema = z.object({
  name: z.string().default("Terraform AI Review"),
});

export const TerraeyeConfigSchema = z.object({
  fail_on: FailOnSchema.default(["critical", "high"]),
  paths: z
    .array(z.string())
    .default(["**/*.tf", "**/*.tfvars", "**/terraform/**"]),
  ignore_paths: z.array(z.string()).default(["**/.terraform/**", "**/vendor/**"]),
  plan_file: z.string().optional(),
  inline_comments: InlineCommentsSchema.default({
    enabled: true,
    min_severity: "high",
  }),
  ai: AiSchema.default({
    enabled: true,
    provider: "openai",
    model: "gpt-4o-mini",
  }),
  cost: CostSchema.default({
    enabled: true,
    currency: "USD",
  }),
  scanners: ScannersSchema.default({
    builtin: true,
    checkov: false,
    tflint: false,
    trivy: false,
  }),
  comment: CommentSchema.default({
    marker: "<!-- terraeye-review -->",
    collapse_details: true,
  }),
  check: CheckSchema.default({
    name: "Terraform AI Review",
  }),
});

export type TerraeyeConfig = z.infer<typeof TerraeyeConfigSchema>;

export function loadConfig(cwd = process.cwd(), explicitPath?: string): TerraeyeConfig {
  const candidates = explicitPath
    ? [explicitPath]
    : [
        "terraeye.yml",
        "terraeye.yaml",
        ".terraeye.yml",
        ".terraeye.yaml",
        "config/terraeye.yml",
      ];

  for (const candidate of candidates) {
    const full = resolve(cwd, candidate);
    if (!existsSync(full)) continue;
    const raw = loadYaml(readFileSync(full, "utf8"));
    return TerraeyeConfigSchema.parse(raw ?? {});
  }

  return TerraeyeConfigSchema.parse({});
}

export function shouldFailCheck(
  failOn: TerraeyeConfig["fail_on"],
  counts: Record<string, number>
): boolean {
  if (failOn === "none") return false;
  return failOn.some((level) => (counts[level] ?? 0) > 0);
}
