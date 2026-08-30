# TerraEye

**Automatic AI PR review for Terraform and AWS infrastructure.**

Works out of the box — **no `terraeye.yml`, no Checkov/TFLint install**.

```yaml
- uses: actions/checkout@v4
- uses: sanchetanparmar/terraeye@v0.1.1
  with:
    fail-on: critical,high
```

<!-- terraeye-review -->

🤖 **Terraform AI Review**

Terraform changes detected and analyzed.

━━━━━━━━━━━━━━━━━━━━━━
📊 SUMMARY
━━━━━━━━━━━━━━━━━━━━━━

Resources:
  🟢 Create:   2
  🟡 Modify:   1
  🔴 Destroy:  1
  ♻️ Replace:  1

Risk Score: 100/100
Risk Level: 🔴 CRITICAL
Security Score: 0/100
Cost delta (est.): +$98/month

Findings: 🔴 4 critical · 🟠 3 high · 🟡 3 medium · 🔵 0 low · ℹ️ 1 info

━━━━━━━━━━━━━━━━━━━━━━
🔐 SECURITY
━━━━━━━━━━━━━━━━━━━━━━

🔴 **CRITICAL** `aws_security_group.app`

This rule allows inbound SSH/RDP from 0.0.0.0/0.

Recommendation:
Restrict SSH access to a trusted CIDR or use AWS SSM instead of exposing SSH publicly.

Example:
```hcl
cidr_blocks = ["10.0.0.0/8"]
```

🔴 **CRITICAL** `aws_s3_bucket.logs`

Bucket ACL set to "public-read".

Recommendation:
Use private ACL and CloudFront/OAC for public content delivery.

🔴 **CRITICAL** `aws_db_instance.production`

aws_db_instance.production sets publicly_accessible = true.

Recommendation:
Set publicly_accessible = false and access via private networking/VPN/bastion/SSM.

🟠 **HIGH** `aws_db_instance.production`

aws_db_instance.production does not clearly enable storage_encrypted = true.

Recommendation:
Set storage_encrypted = true and manage KMS keys intentionally.

🔴 **CRITICAL** `aws_db_instance.production`

Literal value assigned to sensitive-looking attribute `password`.

Recommendation:
Use variables marked sensitive, Secrets Manager, SSM Parameter Store, or CI secrets.

🟠 **HIGH** `aws_security_group.app`

Plan after-state appears to allow broad network access (0.0.0.0/0).

Recommendation:
Restrict CIDRs to trusted networks or use AWS SSM / private connectivity.

━━━━━━━━━━━━━━━━━━━━━━
⚠️ POTENTIAL BUGS
━━━━━━━━━━━━━━━━━━━━━━

🟡 **MEDIUM** `aws_db_instance.production`

aws_db_instance.production sets skip_final_snapshot = true.

Recommendation:
Prefer final snapshots for production databases.

🟠 **HIGH** `aws_db_instance.production`

Terraform plans to destroy and recreate `aws_db_instance.production`. Force-new attributes: instance_class.

Recommendation:
Confirm backups, migration strategy, and acceptable downtime before merge.

━━━━━━━━━━━━━━━━━━━━━━
💰 COST
━━━━━━━━━━━━━━━━━━━━━━

🟡 **MEDIUM**

Approximate net change: **+$98/month**

Estimates are approximate on-demand list prices (us-east-1 style) and exclude data transfer, storage growth, and discounts.

Recommendation:
Treat as a directional estimate only. Validate with AWS Cost Explorer / Infracost for production budgets.

🟡 **MEDIUM** `aws_db_instance.production`

RDS db.t3.medium → db.r6g.large (incl. storage heuristic)

Estimated monthly delta: **+$90/month**

Recommendation:
Confirm sizing is required. Consider Savings Plans / Reserved Instances for steady workloads, or right-size after load testing.

ℹ️ **INFO** `aws_instance.web`

New EC2 t3.micro

Estimated monthly delta: **+$8/month**

Recommendation:
Confirm sizing is required. Consider Savings Plans / Reserved Instances for steady workloads, or right-size after load testing.

━━━━━━━━━━━━━━━━━━━━━━
📋 TERRAFORM PLAN
━━━━━━━━━━━━━━━━━━━━━━

2 to add  ·  1 to change  ·  1 to destroy

━━━━━━━━━━━━━━━━━━━━━━
🤖 RECOMMENDATION
━━━━━━━━━━━━━━━━━━━━━━

Review 7 high-priority finding(s) before merging, especially security and destructive plan actions. Plan includes 1 replacement(s) and 1 destroy(s)—confirm blast radius. Key risk factors: 1 resource replacement(s); 1 destroy(s); 4 critical finding(s).

<details>
<summary>View detailed analysis</summary>

### Active findings
- 🔴 **AWS_SG_PUBLIC_SSH** `testmain.tf:7` — Public SSH/RDP security group
- 🔴 **AWS_S3_PUBLIC_ACL** `testmain.tf:36` — S3 bucket ACL is public
- 🔴 **AWS_RDS_PUBLIC** `testmain.tf:22` — RDS instance is publicly accessible
- 🟠 **AWS_RDS_UNENCRYPTED** `testmain.tf:22` — RDS storage encryption missing/disabled
- 🟡 **AWS_RDS_SKIP_SNAPSHOT** `testmain.tf:22` — RDS skips final snapshot
- 🔴 **TF_HARDCODED_SECRET** `testmain.tf:28` — Possible hardcoded secret
- 🟠 **TFPLAN_REPLACE** — Resource will be replaced: aws_db_instance.production
- 🟠 **TFPLAN_OPEN_SG** — Public exposure in plan: aws_security_group.app
- 🟡 **COST_TOTAL_DELTA** — Net estimated monthly delta: +$98
- 🟡 **COST_INCREASE** — Estimated cost increase: +$90/month
- ℹ️ **COST_INCREASE** — Estimated cost increase: +$8/month

### Risk factors
- 1 resource replacement(s)
- 1 destroy(s)
- 4 critical finding(s)
- 3 high finding(s)
- 2 material cost finding(s)

</details>


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
