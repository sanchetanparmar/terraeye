# TerraEye

**Automatic AI PR review for Terraform and AWS infrastructure.**

Publish once → use in any repo with:

```yaml
- uses: sanchetanparmar/terraeye@v0.1.0
```

## Use in another repository

1. Copy [`examples/consumer-workflow.yml`](examples/consumer-workflow.yml) to that repo as `.github/workflows/terraeye.yml`
2. (Optional) add a `terraeye.yml` config file
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
      - uses: sanchetanparmar/terraeye@v0.1.0
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          fail-on: critical,high
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

GitHub downloads this Action from **this** repo and reviews the **consumer** PR.

## Publish / release this Action

```bash
npm ci
npm test
npm run build
git add -A
git commit -m "Release v0.1.0"
git tag v0.1.0
git push origin HEAD
git push origin v0.1.0
```

Consumers pin a tag (`@v0.1.0`) or a major moving tag (`@v1`).

`dist/index.js` is committed on purpose so `uses:` works without an install step.

## Features

- Automatic PR detection for Terraform paths
- One living summary comment (updated, not spammed)
- Inline comments for high/critical findings
- Finding fingerprints + resolve detection across commits
- Optional Terraform plan JSON, Checkov/TFLint/Trivy, AI summary
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
| `plan-file` | Your `terraform show -json` output (best signal) |
| Cost module | Approximate monthly deltas from the plan |
| Checkov / TFLint / Trivy | Extra scanners if enabled and installed |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | Optional short recommendation text only |

Same engine for **local CLI** and **GitHub Action** — only the entrypoint differs (`dist/cli.js` vs `dist/index.js`).

### Secrets & credentials

- TerraEye does **not** store cloud credentials or API keys in this repo.
- Use GitHub Actions secrets (`secrets.GITHUB_TOKEN`, `secrets.OPENAI_API_KEY`, etc.).
- Never commit PATs, AWS keys, or `.env` files.
- Test fixtures may contain **fake** passwords (e.g. `supersecret`) only to exercise the scanner.

## Optional plan input

```yaml
- uses: hashicorp/setup-terraform@v3
  with:
    terraform_wrapper: false
- run: |
    terraform init -input=false
    terraform plan -input=false -out=tfplan
    terraform show -json tfplan > tfplan.json
  working-directory: infra
- uses: sanchetanparmar/terraeye@v0.1.0
  with:
    plan-file: infra/tfplan.json
```

## Optional cost analysis

Cost estimation is **on by default** (`cost.enabled: true`).

It reads your Terraform plan and estimates monthly delta for common AWS resources (EC2, RDS, NAT, ALB, EKS nodes, etc.).

```yaml
cost:
  enabled: true
  currency: USD
```

Requires `plan-file` for meaningful numbers:

```yaml
- uses: sanchetanparmar/terraeye@v0.1.0
  with:
    plan-file: infra/tfplan.json
```

Estimates are approximate on-demand list prices — not a billing quote.

## Configuration (`terraeye.yml`)

```yaml
fail_on:
  - critical
  - high

inline_comments:
  enabled: true
  min_severity: high

ai:
  enabled: true
  provider: openai   # openai | anthropic | none
  model: gpt-4o-mini

scanners:
  builtin: true
  checkov: false
  tflint: false
  trivy: false
```

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
