import type { Finding, PlanSummary, RiskResult } from "../types.js";
import type { TerraeyeConfig } from "../config/schema.js";

export interface AiInput {
  findings: Finding[];
  plan: PlanSummary;
  risk: RiskResult;
  commitSha: string;
}

export async function generateAiSummary(
  input: AiInput,
  config: TerraeyeConfig
): Promise<string | undefined> {
  if (!config.ai.enabled || config.ai.provider === "none") return undefined;

  const active = input.findings.filter(
    (f) => f.status !== "resolved" && f.status !== "suppressed"
  );
  const prompt = buildPrompt(input, active);

  try {
    if (config.ai.provider === "anthropic") {
      return await callAnthropic(prompt, config.ai.model);
    }
    return await callOpenAi(prompt, config.ai.model);
  } catch {
    return heuristicSummary(input, active);
  }
}

function buildPrompt(input: AiInput, active: Finding[]): string {
  const top = active
    .slice(0, 12)
    .map(
      (f) =>
        `- [${f.severity}] ${f.ruleId} ${f.resource ?? f.file ?? ""}: ${f.title}`
    )
    .join("\n");
  return `You are TerraEye, a Terraform/AWS infrastructure PR reviewer.
Summarize the risk for a developer in 2-4 concise sentences.
Focus on merge-blocking issues, replacements/destroys, and security.
Do not invent findings.

Plan: +${input.plan.add} ~${input.plan.change} -${input.plan.destroy} (replace ${input.plan.replace})
Risk: ${input.risk.level} (${input.risk.score}/100), Security ${input.risk.securityScore}/100
Findings:
${top || "(none)"}`;
}

function heuristicSummary(input: AiInput, active: Finding[]): string {
  if (!active.length && input.plan.add + input.plan.change + input.plan.destroy === 0) {
    return "No Terraform plan changes or findings detected in this review.";
  }
  const blockers = active.filter(
    (f) => f.severity === "critical" || f.severity === "high"
  );
  const parts: string[] = [];
  if (blockers.length) {
    parts.push(
      `Review ${blockers.length} high-priority finding(s) before merging, especially security and destructive plan actions.`
    );
  } else {
    parts.push("No critical/high findings; remaining notes are informational or medium priority.");
  }
  if (input.plan.replace || input.plan.destroy) {
    parts.push(
      `Plan includes ${input.plan.replace} replacement(s) and ${input.plan.destroy} destroy(s)—confirm blast radius.`
    );
  }
  if (input.risk.factors.length) {
    parts.push(`Key risk factors: ${input.risk.factors.slice(0, 3).join("; ")}.`);
  }
  return parts.join(" ");
}

async function callOpenAi(prompt: string, model: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return heuristicSummaryFromPrompt(prompt);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: "Be concise and practical." },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content?.trim() || heuristicSummaryFromPrompt(prompt);
}

async function callAnthropic(prompt: string, model: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return heuristicSummaryFromPrompt(prompt);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const data = (await res.json()) as {
    content?: Array<{ text?: string }>;
  };
  return data.content?.[0]?.text?.trim() || heuristicSummaryFromPrompt(prompt);
}

function heuristicSummaryFromPrompt(prompt: string): string {
  const risk = /Risk: (\w+)/.exec(prompt)?.[1] ?? "unknown";
  return `Automated summary unavailable (no AI key). Overall risk appears ${risk}. Review high-severity findings and plan destroys/replacements carefully.`;
}
