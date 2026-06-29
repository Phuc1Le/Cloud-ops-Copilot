# Cloud Ops Copilot — Product Requirements Document

**An MCP server that lets Claude query your AWS infrastructure in plain English.**

| | |
|---|---|
| Version | 1.0 |
| Status | Draft — ready to build |
| Owner | You |
| Stack | TypeScript / Node.js, AWS SDK v3, MCP TypeScript SDK v1 |
| Client | Claude Code (CLI), local stdio transport |
| MVP target | 3 days |

---

## 1. Summary

Cloud Ops Copilot is a Model Context Protocol (MCP) server that exposes a small set of read-only tools over your AWS account. Once registered with Claude Code, you can ask things like "which Lambdas threw errors in the last hour?" or "what's my top spend category this month?" and Claude will call the right tool, pull live data from AWS, and answer in plain language.

It is deliberately read-only. Nothing it does can change or delete your infrastructure. That makes it safe to build, safe to demo, and a clean teaching vehicle for both MCP and AWS fundamentals.

## 2. Problem statement

Working with AWS day-to-day means context-switching between the console, the CLI, and CloudWatch Logs Insights query syntax. Answering a simple operational question — "is anything broken right now?" — often takes several clicks across multiple service pages. There is no single natural-language surface over your own infrastructure.

Cloud Ops Copilot collapses that into a conversation. The problem it solves is real and common; it does not need to be novel to be valuable.

## 3. Goals and non-goals

### Goals

1. Build a working MCP server from scratch and understand the protocol end-to-end.
2. Learn core AWS concepts hands-on: IAM, credentials, CloudWatch, EC2, Lambda, Cost Explorer.
3. Produce a genuinely resume-worthy, end-to-end project with a recorded demo.
4. Ship an MVP in 3 days, then extend.

### Non-goals (for the MVP)

- No write/mutate operations on AWS (no stopping instances, no deleting anything).
- No multi-account or cross-account support.
- No web UI in the MVP (Claude Code is the interface). A UI is a V2 stretch.
- No production-grade auth/secrets management beyond local environment variables.

## 4. Success criteria

The MVP is "done" when, from a Claude Code session, you can ask all four of these and get correct, live answers:

1. "List my EC2 instances and their states."
2. "Search my CloudWatch logs for errors in the last hour."
3. "Which of my Lambda functions exist and what's their recent error count?"
4. "What did I spend on AWS this month, broken down by service?"

Plus: a README with setup steps and a recorded demo GIF, and an IAM policy that grants only the permissions these four tools need (least privilege).

---

## 5. Tech stack and key decisions

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (Node.js 20+) | Your choice; strong typing makes tool schemas self-documenting |
| MCP SDK | `@modelcontextprotocol/sdk` **v1** (latest 1.x) | Stable, most examples, API won't shift mid-project. See note below. |
| Schema validation | Zod | Required peer dependency of the SDK; defines tool input shapes |
| AWS access | AWS SDK for JavaScript **v3** (modular `@aws-sdk/client-*`) | Tree-shakeable, official, current |
| Transport | stdio (local) | Claude Code spawns the server as a child process; simplest for local dev |
| Client | Claude Code CLI | Your choice; registers servers with `claude mcp add` |
| Runtime config | `.env` via environment variables | AWS region + profile; never commit secrets |

### Decision: SDK v1 vs v2

There is a newer v2 generation of the MCP TypeScript SDK in alpha, tied to a spec revision releasing 2026-07-28. For a first MCP project this week, **use v1** — it's stable and every tutorial and example online targets it. The migration to v2 is a good V2 learning exercise once you understand the fundamentals. Pin the version in `package.json` so an SDK update doesn't surprise you.

### Decision: read-only by design

Every tool maps to a read-only AWS API call (`Describe*`, `List*`, `Get*`, `FilterLogEvents`). The IAM policy will not include any mutating permissions. This is both a safety choice and a teaching point about least privilege.

---

## 6. Architecture

```
You (natural language)
        │
        ▼
   Claude (Claude Code CLI)   ← reasons, decides which tool to call
        │  MCP protocol over stdio
        ▼
   MCP Server (your Node process)
        │  ┌─────────────┬─────────────┬─────────────┬─────────────┐
        │  │ search_logs │  list_ec2   │ lambda_     │ cost_       │
        │  │             │             │ status      │ summary     │
        │  └─────────────┴─────────────┴─────────────┴─────────────┘
        │  AWS SDK v3 calls (signed with your IAM credentials)
        ▼
   AWS APIs
   ┌────────────┬────────────┬────────────┬────────────────┐
   │ CloudWatch │    EC2     │   Lambda   │  Cost Explorer │
   │   Logs     │            │            │                │
   └────────────┴────────────┴────────────┴────────────────┘
```

### Request lifecycle (what happens on one question)

1. You type a question into Claude Code.
2. Claude reads the list of tools your server advertised at startup (name, description, input schema).
3. Claude decides a tool is relevant and emits a `tools/call` request with arguments matching the schema.
4. Your server's handler runs, calls the AWS SDK, and returns a result as MCP content.
5. Claude reads the result and writes a natural-language answer. It may chain multiple tool calls before answering.

### Project structure

```
cloud-ops-copilot/
├── src/
│   ├── index.ts            # server entry: create McpServer, register tools, connect stdio
│   ├── aws/
│   │   └── clients.ts      # shared AWS SDK client factory (region, credentials)
│   └── tools/
│       ├── searchLogs.ts   # CloudWatch Logs
│       ├── listEc2.ts      # EC2
│       ├── lambdaStatus.ts # Lambda + CloudWatch metrics
│       └── costSummary.ts  # Cost Explorer
├── package.json
├── tsconfig.json
├── .env                    # AWS_REGION, AWS_PROFILE — gitignored
├── .gitignore
├── iam-policy.json         # least-privilege policy document
└── README.md
```

---

## 7. Tool specifications

Each tool is a read-only AWS operation with a typed input schema. Keep descriptions clear — Claude relies on them to decide when to call each tool.

### 7.1 `search_logs`

| Field | Value |
|---|---|
| Purpose | Search CloudWatch log events across a log group for a substring within a time window |
| AWS API | `FilterLogEvents` (CloudWatch Logs) |
| Inputs | `logGroupName` (string), `filterPattern` (string, optional), `hoursBack` (number, default 1) |
| Output | Matching log events: timestamp, message, log stream |
| IAM | `logs:FilterLogEvents`, `logs:DescribeLogGroups` |

### 7.2 `list_ec2`

| Field | Value |
|---|---|
| Purpose | List EC2 instances and their state |
| AWS API | `DescribeInstances` (EC2) |
| Inputs | `stateFilter` (string, optional — e.g. "running") |
| Output | Instance ID, type, state, launch time, name tag |
| IAM | `ec2:DescribeInstances` |

### 7.3 `lambda_status`

| Field | Value |
|---|---|
| Purpose | List Lambda functions and recent error counts |
| AWS API | `ListFunctions` (Lambda) + `GetMetricStatistics` (CloudWatch, `Errors` metric) |
| Inputs | `hoursBack` (number, default 24) |
| Output | Function name, runtime, last modified, error count in window |
| IAM | `lambda:ListFunctions`, `cloudwatch:GetMetricStatistics` |

### 7.4 `cost_summary`

| Field | Value |
|---|---|
| Purpose | Summarize spend by service for a date range |
| AWS API | `GetCostAndUsage` (Cost Explorer) |
| Inputs | `granularity` ("MONTHLY" default), `daysBack` (number, default 30) |
| Output | Service name → cost (USD) |
| IAM | `ce:GetCostAndUsage` |

> **Note on Cost Explorer:** it must be enabled in the Billing console once, and it can incur a small per-request charge (a fraction of a cent). Costs also lag ~24h. This is itself a useful AWS lesson; the tutorial flags it.

---

## 8. The complete IAM policy (least privilege)

This is the entire set of permissions the four tools need — nothing more. Save as `iam-policy.json`.

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

`Resource: "*"` is acceptable here because every action is read-only and most of these APIs don't support resource-level scoping anyway. In a production system you'd tighten what you can; for this project, the read-only constraint is the meaningful safety boundary.

---

# PART B — Step-by-step build plan

The first phases include detailed tutorials because you're new to AWS and MCP. Later phases are lighter, on the assumption you'll search specifics as you go.

## Phase 0 — Prerequisites (≈30 min)

You already have an AWS account and one IAM user. Confirm you also have:

- **Node.js 20+** — check with `node --version`. If missing, install from nodejs.org or via a version manager.
- **AWS CLI v2** — check with `aws --version`. If missing, install from the AWS CLI docs.
- **Claude Code** — check with `claude --version`.
- **Git** — for version control and your eventual public repo.

---

## Phase 1 — AWS credentials and IAM (Day 1 morning) — TUTORIAL

The goal: get your machine able to call AWS read-only, using a dedicated least-privilege identity rather than your root or admin user.

### Step 1.1 — Create the IAM policy

1. Sign in to the AWS Console → search "IAM" → open it.
2. Left sidebar → **Policies** → **Create policy**.
3. Click the **JSON** tab, paste the policy from section 8 above, replacing the default.
4. **Next**, name it `CloudOpsCopilotReadOnly`, **Create policy**.

### Step 1.2 — Attach the policy to a dedicated IAM user

You can reuse your existing IAM user, but creating a fresh, narrowly-scoped one is the better habit:

1. IAM → **Users** → **Create user**. Name it `cloud-ops-copilot`.
2. Do **not** grant console access — this identity is for programmatic API calls only.
3. On the permissions step, choose **Attach policies directly**, search for `CloudOpsCopilotReadOnly`, check it, **Next**, **Create user**.

### Step 1.3 — Create an access key

1. Click into the new user → **Security credentials** tab → **Create access key**.
2. Use case: **Command Line Interface (CLI)**. Acknowledge the warning, **Next**, **Create access key**.
3. You'll see an **Access key ID** and a **Secret access key**. The secret is shown **once** — copy both now.

> Security: never paste these into code or commit them. They go only into the AWS CLI credential store (next step) or a gitignored `.env`.

### Step 1.4 — Configure a named CLI profile

In your terminal:

```bash
aws configure --profile cloud-ops-copilot
```

Enter the access key ID, the secret, your default region (e.g. `us-east-1` — **note: Cost Explorer's API only lives in `us-east-1`**, so use that region for this project), and `json` for output format.

### Step 1.5 — Verify it works

```bash
aws sts get-caller-identity --profile cloud-ops-copilot
aws ec2 describe-instances --profile cloud-ops-copilot --region us-east-1
```

The first prints the identity (proof credentials work). The second returns your instances (proof the read permission works). If either fails with `AccessDenied`, recheck the policy attachment. **Fix credential errors here — before touching any MCP config.** A server can only be as correct as the credentials beneath it.

---

## Phase 2 — MCP server skeleton + first tool (Day 1 afternoon) — TUTORIAL

The goal: a minimal MCP server that Claude Code can connect to, exposing one working tool (`list_ec2`).

### Step 2.1 — Initialize the project

```bash
mkdir cloud-ops-copilot && cd cloud-ops-copilot
npm init -y
npm install @modelcontextprotocol/sdk zod
npm install @aws-sdk/client-ec2
npm install -D typescript @types/node tsx
npx tsc --init
```

`tsx` lets you run TypeScript directly without a separate build step during development.

In `package.json`, set `"type": "module"` so ES module imports work, and confirm your `tsconfig.json` targets a modern module system (`"module": "NodeNext"`, `"target": "ES2022"`).

### Step 2.2 — Shared AWS client factory

Create `src/aws/clients.ts`:

```typescript
import { EC2Client } from "@aws-sdk/client-ec2";

const region = process.env.AWS_REGION ?? "us-east-1";

// The SDK automatically picks up the AWS_PROFILE env var, or falls back
// to the default credential chain. No keys in code.
export const ec2 = new EC2Client({ region });
```

You'll add more clients here as you add tools.

### Step 2.3 — The `list_ec2` tool

Create `src/tools/listEc2.ts`:

```typescript
import { DescribeInstancesCommand } from "@aws-sdk/client-ec2";
import { z } from "zod";
import { ec2 } from "../aws/clients.js";

export const listEc2Schema = {
  stateFilter: z
    .string()
    .optional()
    .describe('Optional EC2 state filter, e.g. "running" or "stopped"'),
};

export async function listEc2({ stateFilter }: { stateFilter?: string }) {
  const res = await ec2.send(new DescribeInstancesCommand({}));

  const instances = (res.Reservations ?? []).flatMap((r) =>
    (r.Instances ?? []).map((i) => ({
      id: i.InstanceId,
      type: i.InstanceType,
      state: i.State?.Name,
      launchTime: i.LaunchTime,
      name: i.Tags?.find((t) => t.Key === "Name")?.Value ?? "(no name)",
    }))
  );

  const filtered = stateFilter
    ? instances.filter((i) => i.state === stateFilter)
    : instances;

  return {
    content: [
      { type: "text" as const, text: JSON.stringify(filtered, null, 2) },
    ],
  };
}
```

### Step 2.4 — The server entry point

Create `src/index.ts`:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { listEc2, listEc2Schema } from "./tools/listEc2.js";

const server = new McpServer({
  name: "cloud-ops-copilot",
  version: "0.1.0",
});

server.registerTool(
  "list_ec2",
  {
    title: "List EC2 instances",
    description:
      "List EC2 instances in the configured AWS region with their state, type, and name. Use when asked about servers, instances, or what compute is running.",
    inputSchema: listEc2Schema,
  },
  listEc2
);

// stdio: Claude Code spawns this process and talks over stdin/stdout.
// CRITICAL: never console.log to stdout — it corrupts the protocol.
// Use console.error for any debug output.
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("cloud-ops-copilot MCP server running on stdio");
```

> **The single most common beginner bug:** writing to `stdout` (via `console.log`) in a stdio MCP server. stdout carries the protocol messages; any stray output corrupts them and the server "mysteriously" fails to connect. Always use `console.error` for logging.

### Step 2.5 — Test the server standalone first

Before involving Claude, confirm it starts without crashing:

```bash
AWS_PROFILE=cloud-ops-copilot AWS_REGION=us-east-1 npx tsx src/index.ts
```

You should see the "running on stdio" line (on stderr). It'll then sit waiting for input — that's correct. `Ctrl+C` to exit. If it crashes, the error is in your code or credentials, not in MCP — fix it here.

### Step 2.6 — Register with Claude Code

From your project directory:

```bash
claude mcp add cloud-ops-copilot \
  --env AWS_PROFILE=cloud-ops-copilot \
  --env AWS_REGION=us-east-1 \
  -- npx tsx src/index.ts
```

Everything before `--` is configuration for Claude Code; everything after is the command it runs to spawn your server. Then:

```bash
claude mcp list
```

It should show `cloud-ops-copilot` as connected. If it shows disconnected, run the standalone command from 2.5 to see the real error.

### Step 2.7 — Talk to it

Launch Claude Code in the project, and ask:

> "List my EC2 instances."

Claude should call `list_ec2` and summarize the result. **You now have a working end-to-end MCP server.** Everything after this is adding more tools following the same pattern.

---

## Phase 3 — Add `search_logs` (Day 1 evening / Day 2 morning) — GUIDED

Same pattern as Phase 2. Install the client, write the tool, register it.

```bash
npm install @aws-sdk/client-cloudwatch-logs
```

Key points for this tool:

- Use `FilterLogEvents` with `logGroupName`, an optional `filterPattern`, and a `startTime` computed from `hoursBack` (milliseconds since epoch: `Date.now() - hoursBack * 3600_000`).
- Add a companion that calls `DescribeLogGroups` so Claude can discover valid log group names when the user doesn't know them — or fold a "list log groups" capability into the tool's behavior.
- Truncate large result sets before returning (e.g. cap at 50 events) so you don't flood the context.
- Register it in `index.ts` exactly like `list_ec2`, with a clear description ("Search CloudWatch logs for a pattern within a recent time window").

Test by asking Claude: "Search my logs in /aws/lambda/<some-function> for errors in the last 6 hours."

---

## Phase 4 — Add `lambda_status` and `cost_summary` (Day 2) — LIGHTER GUIDANCE

```bash
npm install @aws-sdk/client-lambda @aws-sdk/client-cloudwatch @aws-sdk/client-cost-explorer
```

**`lambda_status`:** call `ListFunctions` to enumerate functions, then for each (or in a batched loop) call CloudWatch `GetMetricStatistics` on the `AWS/Lambda` namespace, `Errors` metric, dimension `FunctionName`, summed over the window. Return name, runtime, last modified, and error count. Watch out for accounts with many functions — cap how many you query.

**`cost_summary`:** call Cost Explorer `GetCostAndUsage` with a `TimePeriod` (start/end ISO dates), `Granularity: "MONTHLY"`, `Metrics: ["UnblendedCost"]`, and `GroupBy` `SERVICE`. Remember: **`us-east-1` only**, Cost Explorer must be **enabled** in Billing first, results **lag ~24h**, and each call costs a fraction of a cent. Surface costs as a service→USD map.

By the end of Phase 4 you should pass all four success-criteria questions.

---

## Phase 5 — Polish and ship (Day 3) — CHECKLIST

- **Error handling:** wrap each tool body in try/catch and return a useful message (e.g. "AccessDenied on logs:FilterLogEvents — check IAM") rather than letting the process throw. Claude relays these to you helpfully.
- **Result trimming:** ensure every tool caps output size so you never blow out the context window.
- **README:** purpose, architecture diagram, the IAM policy, exact setup commands, the four example prompts, and a recorded demo GIF (use any screen recorder, convert to GIF).
- **`.gitignore`:** confirm `.env`, `node_modules`, and any credential files are ignored. Double-check no keys are in the repo history before pushing.
- **Public repo:** push to GitHub. This is your portfolio artifact.

---

# PART C — Beyond the MVP (V2 ideas)

Each extension teaches a new AWS surface and deepens the project's resume value. Rough order of value-to-effort:

1. **Deploy the server itself to AWS Lambda** using the Streamable HTTP transport instead of stdio. Now it's a cloud-hosted MCP endpoint — a strong talking point, and it teaches Lambda + API Gateway + the HTTP transport.
2. **S3 browsing tool** — `ListBuckets` / `ListObjectsV2`. Teaches S3 and pagination.
3. **Scheduled daily briefing** — an EventBridge rule triggers a Lambda that runs your tools and emails/Slacks a summary. Teaches EventBridge, SNS or a Slack webhook, and event-driven architecture.
4. **RDS slow-query insight** — teaches RDS and Performance Insights.
5. **A custom web UI** — a small React app calling the Anthropic API with your MCP server attached, so non-CLI users get the same experience.

---

# Appendix — Open questions / things to decide later

- **Region scope:** the MVP assumes a single region (`us-east-1`, forced by Cost Explorer). If your resources live elsewhere, you'll either run two regions or parameterize region per tool. Decide when it bites.
- **Log group discovery:** decide whether `search_logs` should auto-discover groups or require the user to name one. Auto-discovery is friendlier but more code.
- **v2 SDK migration:** revisit once the 2026-07-28 spec stabilizes and you're comfortable with v1. Good standalone learning exercise.

---

## Quick reference — the four-step loop for adding any tool

1. `npm install @aws-sdk/client-<service>` and add a client in `src/aws/clients.ts`.
2. Write `src/tools/<name>.ts`: a Zod input schema + an async handler that calls the SDK and returns `{ content: [{ type: "text", text: ... }] }`.
3. `server.registerTool(...)` in `index.ts` with a clear, decision-useful description.
4. Restart the server (Claude Code re-spawns it) and test with a natural-language question.
