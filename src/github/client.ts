import { getOctokit } from "@actions/github";
import type { Finding, ReviewResult, ReviewState } from "../types.js";
import type { TerraeyeConfig } from "../config/schema.js";
import {
  shouldFailCheck,
} from "../config/schema.js";
import {
  countBySeverity,
  findingsNeedingInlineComments,
  toReviewState,
} from "../findings/tracker.js";
import {
  decodeState,
  formatCheckSummary,
  formatCheckTitle,
  formatInlineBody,
  formatSummaryComment,
} from "../report/format.js";
import type { ChangedFile } from "../diff/files.js";

export type Octokit = ReturnType<typeof getOctokit>;

export interface RepoContext {
  owner: string;
  repo: string;
  pullNumber: number;
  headSha: string;
  octokit: Octokit;
}

export async function listPullRequestFiles(
  ctx: RepoContext
): Promise<ChangedFile[]> {
  const files: ChangedFile[] = [];
  const iterator = ctx.octokit.paginate.iterator(
    ctx.octokit.rest.pulls.listFiles,
    {
      owner: ctx.owner,
      repo: ctx.repo,
      pull_number: ctx.pullNumber,
      per_page: 100,
    }
  );
  for await (const response of iterator) {
    for (const f of response.data) {
      files.push({
        path: f.filename,
        status: f.status as ChangedFile["status"],
        patch: f.patch,
      });
    }
  }
  return files;
}

export async function findExistingReviewComment(
  ctx: RepoContext,
  marker: string
): Promise<{ id: number; body: string; state?: ReviewState } | undefined> {
  const iterator = ctx.octokit.paginate.iterator(
    ctx.octokit.rest.issues.listComments,
    {
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: ctx.pullNumber,
      per_page: 100,
    }
  );
  for await (const response of iterator) {
    for (const c of response.data) {
      if (c.body?.includes(marker)) {
        return {
          id: c.id,
          body: c.body,
          state: decodeState(c.body),
        };
      }
    }
  }
  return undefined;
}

export async function upsertSummaryComment(
  ctx: RepoContext,
  config: TerraeyeConfig,
  result: ReviewResult,
  existingId?: number
): Promise<{ commentId: number; state: ReviewState }> {
  const draftState = toReviewState(result.findings, result.commitSha, existingId);
  const body = formatSummaryComment(result, config, draftState);

  if (existingId) {
    await ctx.octokit.rest.issues.updateComment({
      owner: ctx.owner,
      repo: ctx.repo,
      comment_id: existingId,
      body,
    });
    const state = toReviewState(result.findings, result.commitSha, existingId);
    // Rewrite with final comment id embedded
    const finalBody = formatSummaryComment(result, config, state);
    if (finalBody !== body) {
      await ctx.octokit.rest.issues.updateComment({
        owner: ctx.owner,
        repo: ctx.repo,
        comment_id: existingId,
        body: finalBody,
      });
    }
    return { commentId: existingId, state };
  }

  const created = await ctx.octokit.rest.issues.createComment({
    owner: ctx.owner,
    repo: ctx.repo,
    issue_number: ctx.pullNumber,
    body,
  });
  const state = toReviewState(result.findings, result.commitSha, created.data.id);
  await ctx.octokit.rest.issues.updateComment({
    owner: ctx.owner,
    repo: ctx.repo,
    comment_id: created.data.id,
    body: formatSummaryComment(result, config, state),
  });
  return { commentId: created.data.id, state };
}

export async function createInlineComments(
  ctx: RepoContext,
  config: TerraeyeConfig,
  findings: Finding[]
): Promise<Finding[]> {
  if (!config.inline_comments.enabled) return findings;

  const targets = findingsNeedingInlineComments(
    findings,
    config.inline_comments.min_severity
  );
  if (!targets.length) return findings;

  const comments = targets
    .filter((f) => f.file && f.line != null)
    .map((f) => ({
      path: f.file!,
      line: f.line!,
      side: "RIGHT" as const,
      body: formatInlineBody(f),
      fingerprint: f.fingerprint,
    }));

  if (!comments.length) return findings;

  try {
    const review = await ctx.octokit.rest.pulls.createReview({
      owner: ctx.owner,
      repo: ctx.repo,
      pull_number: ctx.pullNumber,
      commit_id: ctx.headSha,
      event: "COMMENT",
      body: "TerraEye inline findings for new issues in this commit.",
      comments: comments.map(({ path, line, side, body }) => ({
        path,
        line,
        side,
        body,
      })),
    });

    // Best-effort: attach review id metadata; GitHub doesn't return per-comment mapping easily
    void review;
    return findings.map((f) => {
      const hit = comments.find((c) => c.fingerprint === f.fingerprint);
      return hit ? { ...f, status: f.status === "new" ? f.status : f.status } : f;
    });
  } catch {
    // Fallback: post individual review comments
    const updated = [...findings];
    for (const c of comments) {
      try {
        const res = await ctx.octokit.rest.pulls.createReviewComment({
          owner: ctx.owner,
          repo: ctx.repo,
          pull_number: ctx.pullNumber,
          commit_id: ctx.headSha,
          path: c.path,
          line: c.line,
          side: "RIGHT",
          body: c.body,
        });
        const idx = updated.findIndex((f) => f.fingerprint === c.fingerprint);
        if (idx >= 0) updated[idx] = { ...updated[idx], commentId: res.data.id };
      } catch {
        // Line may not exist in diff hunk — skip
      }
    }
    return updated;
  }
}

export async function resolveFixedInlineComments(
  ctx: RepoContext,
  findings: Finding[]
): Promise<void> {
  const resolved = findings.filter((f) => f.status === "resolved" && f.commentId);
  for (const f of resolved) {
    try {
      await ctx.octokit.rest.pulls.createReplyForReviewComment({
        owner: ctx.owner,
        repo: ctx.repo,
        pull_number: ctx.pullNumber,
        comment_id: f.commentId!,
        body: "✅ TerraEye: this finding appears fixed in the latest commit.",
      });
    } catch {
      // ignore
    }
  }
}

export async function publishCheck(
  ctx: RepoContext,
  config: TerraeyeConfig,
  result: ReviewResult
): Promise<"success" | "failure" | "neutral"> {
  const counts = countBySeverity(result.findings);
  const failed = shouldFailCheck(config.fail_on, counts);
  const conclusion = failed ? "failure" : "success";

  await ctx.octokit.rest.checks.create({
    owner: ctx.owner,
    repo: ctx.repo,
    name: config.check.name,
    head_sha: ctx.headSha,
    status: "completed",
    conclusion,
    output: {
      title: formatCheckTitle(result),
      summary: formatCheckSummary(result),
      text: result.aiSummary,
    },
  });

  return conclusion;
}
