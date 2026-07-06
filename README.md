# Cloud Ops Copilot

An AWS operations assistant, built two ways on the same backend: a local **MCP server** for Claude Code, and a **hosted Lambda + web chat UI** for anyone else. Ask it things like:

- *"What S3 buckets do I have?"*
- *"Do any of my IAM users have no MFA enabled?"*
- *"Which of my Lambda functions threw errors in the last hour?"*
- *"What's my top spend category this month?"*
- *"Are any EC2 instances currently running?"*

Claude decides which AWS tool to call, pulls live data, and answers in plain language.

---

## Architecture

```
Claude Code CLI ──stdio──▶ MCP Server (local, src/index.ts)
                                  │
                                  ├── same 7 tools ──┐
                                  │                  │
Claude Code CLI ──HTTP──▶ ┌───────┴──────┐           │
Anthropic API (MCP        │  AWS Lambda  │◀──────────┘
 connector, from the      │ (src/lambda.ts,
 web UI, server-side) ───▶│  Streamable HTTP) ── IAM execution role ──▶ AWS APIs
                           └──────────────┘

Browser ──HTTPS──▶ Next.js chat UI (Vercel)
                        │ POST /api/chat (password-gated)
                        ▼
                  Anthropic API (Claude Sonnet 5, streaming)
                        │ mcp_servers connector — Anthropic's
                        │ infra calls the Lambda endpoint directly
                        ▼
                  (same Lambda + AWS path as above)
```

Everything the tools do is **read-only** — nothing here can create, modify, or delete AWS resources.

---

## Tools

| Tool | AWS APIs | What it answers |
|---|---|---|
| `list_ec2` | EC2 `DescribeInstances` | What instances exist, and their state |
| `list_log_groups` | CloudWatch Logs `DescribeLogGroups` | What log groups exist, before searching them |
| `search_logs` | CloudWatch Logs `FilterLogEvents` | Pattern search across a log group's recent history |
| `lambda_status` | Lambda `ListFunctions` + CloudWatch `GetMetricStatistics` | Deployed functions, runtime, recent error counts |
| `cost_summary` | Cost Explorer `GetCostAndUsage` | Spend broken down by service, current billing period |
| `browse_s3` | S3 `ListBuckets`, `ListObjectsV2` | Buckets, and paginated object listing by prefix |
| `iam_audit` | IAM `ListUsers`, `GetLoginProfile`, `ListMFADevices` | Which users lack MFA or have console access |

---

## Security notes

- **Least-privilege IAM everywhere.** The local server's AWS profile and the Lambda's execution role both use the same read-only policy in [`iam-policy.json`](iam-policy.json) — no write/delete permissions exist for this tool to abuse, accidentally or otherwise.
- **No static AWS credentials in the deployed path.** The Lambda authenticates to AWS via its IAM execution role — short-lived, auto-rotated credentials injected by AWS at invoke time, not a key sitting in an env var or file.
- **The Lambda Function URL itself has no auth in front of it** (`Auth type: NONE`), which is a real, known tradeoff: anyone with the URL could call the AWS tools directly, bypassing the web UI's password gate entirely. Acceptable here because (a) every tool is strictly read-only, (b) the URL isn't published, and (c) this is a single-tenant demo pointed at one AWS account, not a multi-user product. A production version would put IAM auth or an API-key check directly on the Lambda, not just on the UI layer in front of it.
- **The web UI has its own password gate** (`x-api-key` header, checked server-side in the API route) — but this only protects the chat UI's convenience layer, not the underlying Lambda, per the point above.
- **The live URL is intentionally not published here.** It's a real, working deployment against a real personal AWS account and a metered Anthropic API key — publishing it would mean strangers running up API costs and probing a live account for no benefit to anyone. Treat the Vercel/Lambda deployment as a completed exercise, verified working, rather than a public demo link.

---

## Project structure

```
src/
├── index.ts               # stdio entry point (local dev / Claude Code)
├── lambda.ts               # Streamable HTTP entry point (deployed to Lambda)
├── aws/
│   └── client.ts           # Shared AWS SDK client instances (region from env)
└── tools/
    ├── register.ts         # Shared tool registration — both entry points call this
    ├── listEc2.ts
    ├── listLogGroups.ts
    ├── searchLogs.ts
    ├── lambdaStatus.ts
    ├── costSummary.ts
    ├── browseS3.ts
    └── iamAudit.ts
build.mjs                   # esbuild bundle script for the Lambda build
deploy.sh                   # build + zip helper (upload via Lambda console)
iam-policy.json             # least-privilege IAM policy (local profile + Lambda role)

cloud-ops-ui/                # Next.js web chat UI (deployed to Vercel)
├── app/
│   ├── page.tsx             # streaming chat interface
│   └── api/chat/route.ts    # server-side Anthropic API call, MCP connector, password gate
```

---

## Running it locally

**Prerequisites:** Node.js 20+, an AWS account, Claude Code CLI.

### Option A — Claude Code via stdio (fastest — no AWS Lambda needed)

No AWS credentials are shipped in this repo — `AWS_PROFILE` below just needs to point at a profile in **your own** `~/.aws/credentials`, scoped to the read-only policy in [`iam-policy.json`](iam-policy.json):

```bash
aws configure --profile cloud-ops-copilot   # paste an access key for a read-only IAM user/role in *your* account
npm install
cp .env.example .env        # AWS_PROFILE=cloud-ops-copilot, AWS_REGION=us-east-1
npx tsx src/index.ts        # sanity-check the server starts (Ctrl+C to stop)
```

`.mcp.json` isn't committed (it's gitignored, since in this repo's own copy it points at a live deployment — see Security notes above). Create your own from the template, which defaults to local stdio — no AWS Lambda required:

```bash
cp .mcp.json.example .mcp.json
```

Open this directory in Claude Code and confirm it connected:

```bash
claude mcp list
```

Then just ask it something, e.g. *"List my EC2 instances."*

### Option B — Deploy to AWS Lambda (needed for the web UI, or Claude Code over HTTP)

The web UI can't spawn a local process for you — Anthropic's servers call the MCP connector's URL directly over the internet, so it needs a real HTTPS endpoint. This is the same deployment as Phase 2 in the project's history: package the server, run it on Lambda, expose it via a Function URL.

1. **Build and zip:**
   ```bash
   npm run build                # esbuild bundles src/lambda.ts + deps into dist/index.js
   ./deploy.sh                  # zips dist/index.js into lambda-deploy.zip
   ```
2. **Create the IAM execution role** — IAM → Roles → Create role → AWS service → Lambda → attach `AWSLambdaBasicExecutionRole` and a policy scoped to [`iam-policy.json`](iam-policy.json).
3. **Create the Lambda function** — Lambda → Create function → Node.js 20.x → use the role from step 2 → Code tab → Upload from → `.zip file` → `lambda-deploy.zip` → set Handler to `index.handler` → bump Timeout to 30s.
4. **Create a Function URL** — Configuration tab → Function URL → Create → Auth type `NONE` (see Security notes above for why that's an explicit, accepted tradeoff here, not an oversight) → Save. You'll get a URL like `https://abc123.lambda-url.us-east-1.on.aws/` — your MCP endpoint is that URL **plus `/mcp`**.
5. **Point Claude Code at it instead of local stdio:**
   ```bash
   cp .mcp.json.http.example .mcp.json   # then edit the url field with your real Function URL + /mcp
   claude mcp list                        # should show it connected over HTTP
   ```

Every time you change tool code, re-run step 1 and re-upload the zip through the Lambda console's Code tab.

