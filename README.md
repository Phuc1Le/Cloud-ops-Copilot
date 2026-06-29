# Cloud Ops Copilot

An MCP server that lets Claude query your AWS infrastructure in plain English.

Ask things like:
- *"Which of my Lambda functions threw errors in the last hour?"*
- *"What's my top spend category this month?"*
- *"Are any EC2 instances currently running?"*
- *"Search my Lambda logs for exceptions in the last 6 hours."*

Claude calls the right tool, pulls live data from AWS, and answers in natural language — without you ever leaving the chat.

---

## Architecture

```
You (natural language)
        │
        ▼
   Claude (Claude Code CLI)   ← reasons, decides which tool to call
        │  MCP protocol over stdio
        ▼
   MCP Server (Node.js / TypeScript)
        │
        ├── list_ec2          EC2 › DescribeInstances
        ├── list_log_groups   CloudWatch Logs › DescribeLogGroups
        ├── search_logs       CloudWatch Logs › FilterLogEvents
        ├── lambda_status     Lambda › ListFunctions + CloudWatch › GetMetricStatistics
        └── cost_summary      Cost Explorer › GetCostAndUsage
        │
        ▼
   AWS APIs (read-only, signed with IAM credentials)
```

Everything is **read-only** — this server cannot change or delete any infrastructure.

---

## Prerequisites

- Node.js 20+
- AWS CLI v2
- Claude Code CLI (`claude --version`)
- An AWS account with Cost Explorer enabled (Billing console → Cost Explorer → Enable, one-time)

---

## Setup

### 1. Create the IAM policy

In the AWS Console → IAM → Policies → Create policy → JSON tab, paste the policy from `iam-policy.json`, name it `CloudOpsCopilotReadOnly`, and save it.

### 2. Create a dedicated IAM user

IAM → Users → Create user → name it `cloud-ops-copilot` → no console access → attach `CloudOpsCopilotReadOnly` directly.

Generate an access key: Security credentials tab → Create access key → CLI use case. Copy both values — the secret is shown once.

### 3. Configure a named AWS CLI profile

```bash
aws configure --profile cloud-ops-copilot
# AWS Access Key ID:     <paste key ID>
# AWS Secret Access Key: <paste secret>
# Default region name:   us-east-1
# Default output format: json
```

> Use `us-east-1` — Cost Explorer's API only lives there.

### 4. Verify credentials work

```bash
aws sts get-caller-identity --profile cloud-ops-copilot
aws ec2 describe-instances --profile cloud-ops-copilot --region us-east-1
```

Both should succeed. Fix any `AccessDenied` errors before proceeding.

### 5. Install dependencies

```bash
npm install
```

### 6. Configure environment

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

`.env`:
```
AWS_PROFILE=cloud-ops-copilot
AWS_REGION=us-east-1
```

### 7. Test the server standalone

```bash
npx tsx src/index.ts
```

You should see `cloud-ops-copilot MCP server running on stdio` on stderr. `Ctrl+C` to stop.

### 8. Open the project in Claude Code

The repo includes `.mcp.json`, which registers the server automatically — no `claude mcp add` needed. Just open Claude Code from this directory and verify the server connected:

```bash
claude mcp list
```

AWS credentials are loaded from your `.env` file via `dotenv`.

---

## Example prompts

Once registered, open a Claude Code session in this directory and try:

```
List my EC2 instances and their states.
```

```
Search my CloudWatch logs for errors in /aws/lambda/<function-name> in the last 6 hours.
```

```
Which of my Lambda functions exist and what's their recent error count?
```

```
What did I spend on AWS this month, broken down by service?
```

---

## IAM policy

All four tools need exactly these permissions — nothing more:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudOpsCopilotReadOnly",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances",
        "logs:FilterLogEvents",
        "logs:DescribeLogGroups",
        "lambda:ListFunctions",
        "cloudwatch:GetMetricStatistics",
        "ce:GetCostAndUsage"
      ],
      "Resource": "*"
    }
  ]
}
```

Full policy document is in [`iam-policy.json`](iam-policy.json).

---

## Project structure

```
src/
├── index.ts              # MCP server entry: registers all tools, connects stdio transport
├── aws/
│   └── client.ts         # Shared AWS SDK client instances (region from env)
└── tools/
    ├── listEc2.ts         # EC2 instances
    ├── listLogGroups.ts   # CloudWatch log group discovery
    ├── searchLogs.ts      # CloudWatch log search
    ├── lambdaStatus.ts    # Lambda functions + error metrics
    └── costSummary.ts     # Cost Explorer spend breakdown
iam-policy.json           # Least-privilege IAM policy for this server
```

---

## Notes

- **Cost Explorer** must be enabled once in the AWS Billing console before `cost_summary` will work. Each call costs a fraction of a cent. Results lag ~24 hours.
- **stdout is reserved for the MCP protocol.** Never add `console.log` to the server — use `console.error` for any debug output.
- `lambda_status` queries up to 20 functions. If you have more, the oldest-registered ones beyond 20 are omitted.
