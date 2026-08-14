import * as core from "@actions/core";
import * as github from "@actions/github";
import { loadConfig, shouldFailCheck } from "./config/schema.js";
import { analyzePullRequest } from "./analyze.js";
import { countBySeverity } from "./findings/tracker.js";
import {
  createInlineComments,
  findExistingReviewComment,
  listPullRequestFiles,
  publishCheck,
  resolveFixedInlineComments,
  upsertSummaryComment,
  type RepoContext,
} from "./github/client.js";
import { isTerraformPath } from "./diff/files.js";

async function run(): Promise<void> {
  const token =
    core.getInput("github-token") ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN;
  if (!token) {
    throw new Error("Missing github-token / GITHUB_TOKEN");
  }

  const configPath = core.getInput("config-path") || undefined;
  const planFile = core.getInput("plan-file") || undefined;
  const workingDirectory = core.getInput("working-directory") || process.cwd();

  const config = loadConfig(workingDirectory, configPath);
  if (planFile) config.plan_file = planFile;

  const failOnInput = core.getInput("fail-on");
  if (failOnInput) {
    config.fail_on =
      failOnInput.trim() === "none"
        ? "none"
        : failOnInput.split(",").map((s) => s.trim()) as typeof config.fail_on;
  }

  const context = github.context;
  if (!context.payload.pull_request) {
    core.info("Not a pull_request event — skipping TerraEye review.");
    return;
  }

  const octokit = github.getOctokit(token);
  const pr = context.payload.pull_request;
  const ctx: RepoContext = {
    owner: context.repo.owner,
    repo: context.repo.repo,
    pullNumber: pr.number,
    headSha: pr.head.sha,
    octokit,
  };

  const files = await listPullRequestFiles(ctx);
  const tfTouched = files.some((f) => isTerraformPath(f.path, config));
  if (!tfTouched) {
    core.info("No Terraform paths changed — skipping.");
    return;
  }

  const existing = await findExistingReviewComment(ctx, config.comment.marker);
  const previousState = existing?.state;
  const incremental = Boolean(
    previousState?.lastCommitSha && previousState.lastCommitSha !== ctx.headSha
  );

  core.info(
    `Analyzing PR #${ctx.pullNumber} @ ${ctx.headSha.slice(0, 7)} (${incremental ? "incremental" : "full"} review)`
  );

  const result = await analyzePullRequest({
    cwd: workingDirectory,
    config,
    files,
    commitSha: ctx.headSha,
    previousState,
    incremental,
    planFile: config.plan_file,
  });

  const withInline = await createInlineComments(ctx, config, result.findings);
  result.findings = withInline;
  await resolveFixedInlineComments(ctx, result.findings);

  const { commentId } = await upsertSummaryComment(
    ctx,
    config,
    result,
    existing?.id
  );
  core.info(`Summary comment ${existing?.id ? "updated" : "created"}: ${commentId}`);

  const conclusion = await publishCheck(ctx, config, result);
  const counts = countBySeverity(result.findings);

  core.setOutput("risk-score", String(result.risk.score));
  core.setOutput("security-score", String(result.risk.securityScore));
  core.setOutput("risk-level", result.risk.level);
  core.setOutput("conclusion", conclusion);
  core.setOutput("findings-critical", String(counts.critical));
  core.setOutput("findings-high", String(counts.high));

  if (shouldFailCheck(config.fail_on, counts)) {
    core.setFailed(
      `TerraEye failed check (fail_on=${JSON.stringify(config.fail_on)}): ` +
        `${counts.critical} critical, ${counts.high} high`
    );
  }
}

run().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  core.setFailed(message);
});
