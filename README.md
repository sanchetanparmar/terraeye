# TerraEye

**Automatic AI PR review for Terraform and AWS infrastructure.**

Publish once → use in any repo with:

```yaml
- uses: sanchetanparmar/terraeye@v0.1.1
```

## Required vs optional (quick answer)

| What | Needed? | Default |
|------|---------|---------|
| Workflow file calling the Action | **Required** | — |
| `terraeye.yml` | Optional | Built-in defaults (below) |
| `github-token` | Optional to write | `${{ github.token }}` / `secrets.GITHUB_TOKEN` |
| `fail-on` | Optional | `critical,high` |
| `plan-file` | Optional for security-only | **Required for cost + plan summary** |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | Optional | AI summary skipped / heuristic text if missing |
| Checkov / TFLint / Trivy | Optional | **Off** |

**Minimum that works (security review, no cost):**

```yaml
- uses: actions/checkout@v4
- uses: sanchetanparmar/terraeye@v0.1.1
  with:
    fail-on: critical,high
```

**Needed for cost numbers:** generate a plan in CI and pass `plan-file` (see below).

## Use in another repository

1. Copy [`examples/consumer-workflow.yml`](examples/consumer-workflow.yml) to that repo as `.github/workflows/terraeye.yml`
2. (Optional) add a `terraeye.yml` config file — only if you want to customize defaults
3. Open a PR that changes `*.tf` / `*.tfvars`

Example:

```yaml
name: TerraEye

on:
  pull_request:
    types: [opened, synchronize, reopened]
    paths:
      - "**/*.tf"
      - "**/*.tfvars"
      - "**/terraform/**"

permissions:
  contents: read
  pull-requests: write
  checks: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: sanchetanparmar/terraeye@v0.1.1
        with:
          # github-token defaults to github.token — optional to set explicitly
          github-token: ${{ secrets.GITHUB_TOKEN }}
          fail-on: critical,high
        env:
          # Optional — only for AI recommendation text
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

GitHub downloads this Action from **this** repo and reviews the **consumer** PR.

Comments appear as `github-actions[bot]` when using `GITHUB_TOKEN` (normal). Use a PAT/App token if you want a custom author name.

## Action inputs (`with:`)

| Input | Required | Default | Notes |
|-------|----------|---------|--------|
| `github-token` | No | `${{ github.token }}` | Read PR + post comment/check |
| `config-path` | No | `terraeye.yml` | Used only if that file exists |
| `working-directory` | No | `.` | Scan / config root |
| `plan-file` | No* | _(none)_ | *Needed for **cost** and plan create/change/destroy |
| `fail-on` | No | from config / `critical,high` | `critical,high` or `none` |

### Action outputs

`risk-score`, `security-score`, `risk-level`, `conclusion`, `findings-critical`, `findings-high`

## Defaults (`terraeye.yml`)

You do **not** need this file. If missing, TerraEye uses:

```yaml
fail_on:
  - critical
  - high

paths:
  - "**/*.tf"
  - "**/*.tfvars"
  - "**/terraform/**"

ignore_paths:
  - "**/.terraform/**"
  - "**/vendor/**"

inline_comments:
  enabled: true
  min_severity: high

ai:
  enabled: true
  provider: openai      # openai | anthropic | none
  model: gpt-4o-mini

cost:
  enabled: true         # feature on — still needs plan-file for $ amounts
  currency: USD

scanners:
  builtin: true         # always recommended
  checkov: false
  tflint: false
  trivy: false

comment:
  marker: "<!-- terraeye-review -->"
  collapse_details: true

check:
  name: Terraform AI Review
```

### Where does each setting go?

| Setting | Put it in… |
|---------|------------|
| `fail-on`, `plan-file`, `config-path`, `working-directory` | Action `with:` (best for CI) |
| `cost`, `ai`, `scanners`, `inline_comments`, `paths` | `terraeye.yml` |
| `plan_file` | Also allowed in `terraeye.yml`, but Action `plan-file` **overrides** it |

## Cost analysis — when you need `plan-file`

| Setup | Security findings | Plan +/-/~ | Cost `$/month` |
|-------|-------------------|------------|----------------|
| Action only (no plan) | Yes | No | Shows “needs plan JSON” |
| Action + `plan-file` | Yes | Yes | Yes (approximate) |

`cost.enabled: true` only **turns the feature on**. It does **not** create a plan by itself.

```yaml
- uses: hashicorp/setup-terraform@v3
  with:
    terraform_wrapper: false

- name: Terraform plan
  working-directory: infra   # your Terraform folder
  run: |
    terraform init -input=false
    terraform plan -input=false -out=tfplan
    terraform show -json tfplan > tfplan.json
  env:
    AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}

- uses: sanchetanparmar/terraeye@v0.1.1
  with:
    plan-file: infra/tfplan.json
    fail-on: critical,high
```

Estimates are approximate on-demand list prices — not a billing quote.

> **Note:** This repo’s self-test workflow uses `tests/fixtures/plan.json` only for demos. Consumer repos must generate their own plan.

## Features

- Automatic PR detection for Terraform paths
- One living summary comment (updated, not spammed)
- Inline comments for high/critical findings
- Finding fingerprints + resolve detection across commits
- Optional Terraform plan JSON, Checkov/TFLint/Trivy, AI summary
- Cost deltas when `plan-file` is provided
- Configurable `fail_on` for the GitHub Check

## How it works (what produces the results)

TerraEye does **not** use a separate hosted backend or database.  
It runs inside **GitHub Actions** (or locally via the CLI) and builds the review from these sources:

```text
PR / local Terraform files
        ↓
┌──────────────────────────────────────┐
│ 1. GitHub API                        │
│    Changed files + diff patches      │
│    Posts summary comment, inline     │
│    notes, and Check status           │
├──────────────────────────────────────┤
│ 2. Builtin Terraform rules           │
│    Scans .tf for AWS security issues │
│    (open SG/SSH, public RDS/S3,      │
│     IAM wildcards, hardcoded secrets)│
├──────────────────────────────────────┤
│ 3. Terraform plan JSON (optional)    │
│    create / change / destroy /       │
│    replace detection                 │
├──────────────────────────────────────┤
│ 4. Cost engine                       │
│    Local price heuristics from plan  │
│    (no AWS Billing API)              │
├──────────────────────────────────────┤
│ 5. Optional scanners                 │
│    Checkov / TFLint / Trivy          │
│    (off by default)                  │
├──────────────────────────────────────┤
│ 6. Risk engine                       │
│    Scores findings + plan impact     │
├──────────────────────────────────────┤
│ 7. AI summary (optional)             │
│    OpenAI or Anthropic — only if     │
│    API key is set in secrets/env     │
└──────────────────────────────────────┘
        ↓
PR comment + Check + inline findings
```

| Piece | Role |
|--------|------|
| `GITHUB_TOKEN` | Read PR files/diff; write comment & check |
| Builtin rules | Our TypeScript security/reliability checks on `.tf` |
| `plan-file` | Your `terraform show -json` output (best signal + cost) |
| Cost module | Approximate monthly deltas from the plan |
| Checkov / TFLint / Trivy | Extra scanners if enabled and installed |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | Optional short recommendation text only |

Same engine for **local CLI** and **GitHub Action** — only the entrypoint differs (`dist/cli.js` vs `dist/index.js`).

### Secrets & credentials

- TerraEye does **not** store cloud credentials or API keys in this repo.
- Use GitHub Actions secrets (`secrets.GITHUB_TOKEN`, `secrets.OPENAI_API_KEY`, etc.).
- Never commit PATs, AWS keys, or `.env` files.
- Test fixtures may contain **fake** passwords (e.g. `supersecret`) only to exercise the scanner.

## Publish / release this Action

```bash
npm ci
npm test
npm run build
git add -A
git commit -m "Release v0.1.1"
git tag v0.1.1
git push origin HEAD
git push origin v0.1.1
```

Consumers pin a tag (`@v0.1.1`) or branch (`@main`).

`dist/index.js` is committed on purpose so `uses:` works without an install step.

## Local CLI

```bash
npm ci
npm run build
node dist/cli.js review \
  --cwd tests/fixtures/insecure \
  --plan tests/fixtures/plan.json \
  --config terraeye.yml
```

## Development

```bash
npm ci
npm test
npm run typecheck
npm run build
```

## License

MIT
