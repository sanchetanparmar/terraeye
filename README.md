# TerraEye

**Automatic AI PR review for Terraform and AWS infrastructure.**

Create a PR → TerraEye reviews Terraform changes → read clear findings → fix → push → it re-reviews without spam.

```text
Developer creates PR
        ↓
GitHub Action / webhook
        ↓
┌──────────────────────────┐
│ Terraform Plan (optional)│
│ Builtin AWS rules        │
│ Checkov / Trivy / TFLint │
│ Cost signals             │
│ AI summary               │
└──────────────────────────┘
        ↓
Risk engine → GitHub Check → one living PR comment + inline notes
```

## Features

- **Automatic PR detection** on `opened` / `synchronize` / `reopened` for `*.tf`, `*.tfvars`, and Terraform module paths
- **Single living summary comment** (updated in place — no review spam)
- **Inline review comments** for critical/high findings
- **Finding fingerprints** (`file + line + rule + resource`) with automatic resolve detection
- **Incremental re-review** focused on new changes vs the last reviewed commit
- **Terraform plan awareness** (`terraform show -json`) for create/change/destroy/replace risk
- **Builtin AWS security rules** (open SG/SSH, public RDS/S3, IAM wildcards, hardcoded secrets, encryption gaps)
- **Optional Checkov / TFLint / Trivy**
- **Configurable check failure**: `fail_on: [critical, high]` or `fail_on: none`
- **Local CLI** for the same analysis outside GitHub

## Quick start (GitHub Action)

1. Copy `config/terraeye.yml` to your repo root (or keep the path you prefer).
2. Add a workflow (see `.github/workflows/terraeye.yml`):

```yaml
name: TerraEye Review

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
  terraeye:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install & build TerraEye
        run: npm ci && npm run build:action
        working-directory: path/to/terraeye   # or consume as a published action

      - name: TerraEye
        uses: ./
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          config-path: terraeye.yml
          # plan-file: tfplan.json
          fail-on: critical,high
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

### With Terraform plan (recommended)

```yaml
- uses: hashicorp/setup-terraform@v3
  with:
    terraform_wrapper: false

- name: Plan
  working-directory: infra
  run: |
    terraform init -input=false
    terraform plan -input=false -out=tfplan
    terraform show -json tfplan > tfplan.json

- name: TerraEye
  uses: ./
  with:
    plan-file: infra/tfplan.json
```

## Configuration

```yaml
fail_on:
  - critical
  - high

paths:
  - "**/*.tf"
  - "**/*.tfvars"
  - "**/terraform/**"

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
  --config config/terraeye.yml \
  --out /tmp/terraeye.md \
  --json /tmp/terraeye.json
```

Re-run with `--state .terraeye-state.json` to simulate incremental PR updates (dedupe + resolve).

## Anti-spam behavior

1. One summary comment marked with `<!-- terraeye-review -->` — updated, not recreated
2. Embedded base64 review state tracks fingerprints across commits
3. Inline comments only for **new** findings at/above `min_severity`
4. Resolved findings get a reply instead of a duplicate thread
5. Incremental mode prefers changed hunks after the first review

## Example comment shape

```text
🤖 Terraform AI Review

📊 SUMMARY
  🟢 Create: 5   🟡 Modify: 3   🔴 Destroy: 1
  Risk Score: 72/100   Risk Level: 🟠 HIGH

🔐 SECURITY
🔴 HIGH  aws_security_group.app
Port 22 is exposed to 0.0.0.0/0.

⚠️ POTENTIAL BUGS
🟠 aws_db_instance.production
This change will replace the existing RDS instance.

📋 TERRAFORM PLAN
5 to add · 3 to change · 1 to destroy
```

## Development

```bash
npm ci
npm test
npm run typecheck
npm run build:action
```

## License

MIT
