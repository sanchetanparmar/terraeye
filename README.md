# TerraEye

**Automatic AI PR review for Terraform and AWS infrastructure.**

Works out of the box — **no `terraeye.yml`, no Checkov/TFLint install**.

```yaml
- uses: actions/checkout@v4
- uses: sanchetanparmar/terraeye@v0.1.1
  with:
    fail-on: critical,high
```

Open a PR that changes `*.tf` → TerraEye comments automatically.

## What you get by default (nothing to install)

| Feature | On by default? | Extra setup? |
|---------|----------------|--------------|
| Builtin AWS/Terraform security rules | Yes | No |
| Inline comments (high/critical) | Yes | No |
| PR summary comment | Yes | No |
| GitHub Check (`fail-on: critical,high`) | Yes | No |
| Risk score | Yes | No |
| Cost `$/month` | Ready, but… | Needs `plan-file` (see below) |
| AI recommendation text | Ready, but… | Needs `OPENAI_API_KEY` secret (optional) |
| Checkov / TFLint / Trivy | **No** | Don’t use unless you want advanced setup |

**You do not need a `terraeye.yml` file.** Defaults are already built into TerraEye.

## Use in another repository

Copy [`examples/consumer-workflow.yml`](examples/consumer-workflow.yml) to `.github/workflows/terraeye.yml`:

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
          fail-on: critical,high
```

That’s it.

| Optional add-on | How |
|-----------------|-----|
| AI summary sentence | Add `env: OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}` |
| Cost `$/month` + plan +/- | Generate plan + pass `plan-file` (next section) |

Comments show as `github-actions[bot]` when using the default GitHub token — normal.

## Action inputs (`with:`)

| Input | Default | When to set |
|-------|---------|-------------|
| `fail-on` | `critical,high` | Or `none` to never fail the check |
| `github-token` | `github.token` | Usually leave unset |
| `plan-file` | none | Only if you want cost + plan summary |
| `working-directory` | `.` | If Terraform lives in a subfolder |
| `config-path` | `terraeye.yml` | Only if you created a custom config file |

## Cost (optional)

Security review works **without** a plan.  
Cost dollars need a Terraform plan JSON:

```yaml
- uses: hashicorp/setup-terraform@v3
  with:
    terraform_wrapper: false

- name: Terraform plan
  working-directory: infra
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

Without `plan-file`, the report may say cost needs plan JSON — security findings still work.

## How it works

No hosted backend. The Action runs in GitHub and:

1. Reads the PR Terraform diff  
2. Runs **builtin** security rules (built into TerraEye — nothing to install)  
3. Optionally reads your plan JSON for destroys/replaces + cost  
4. Optionally calls OpenAI if `OPENAI_API_KEY` is set  
5. Posts one summary comment + inline notes + Check  

## Secrets

- Do not commit API keys or cloud credentials  
- Use GitHub Actions secrets only  
- `GITHUB_TOKEN` is provided automatically by GitHub  

## Local CLI (this repo)

```bash
npm ci && npm run build
node dist/cli.js review \
  --cwd tests/fixtures/insecure \
  --plan tests/fixtures/plan.json
```

## License

MIT
