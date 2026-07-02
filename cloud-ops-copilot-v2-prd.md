# Cloud Ops Copilot V2 — Product Requirements Document

**Extending the local CLI tool into a deployed cloud service, web product, and event-driven system.**

| | |
|---|---|
| Version | 2.0 |
| Status | Draft — ready to build |
| Prerequisite | V1 complete (4 tools, stdio transport, Claude Code working) |
| Phases covered | 1 – Tool Expansion → 2 – Lambda Deployment → 3 – Web UI → 4 – Scheduled Briefing → 5 – Multi-region + CloudFormation |

---

## 1. What you're building across V2

V1 gave you a working local tool. V2 turns it into a real cloud product across five phases, each with a distinct architectural lesson:

| Phase | What changes | Core lesson |
|---|---|---|
| 1 | 3 more tools (S3, IAM audit, Health) | AWS service breadth, pagination |
| 2 | Server deployed to Lambda + HTTP transport | Cloud deployment, IAM roles, packaging |
| 3 | Web UI on Vercel, Anthropic API streaming | Full-stack AI product |
| 4 | Daily briefing via EventBridge + Slack | Event-driven architecture |
| 5 | Multi-region + CloudFormation tool | Cross-region AWS, IaC awareness |

---

## 2. Architecture evolution

Each phase changes the architecture. Reading this first gives you the full picture before you build any single piece.

**After V1 (your current state):**
```
You (Claude Code CLI)
    │  stdio transport
    ▼
MCP Server (local Node process on your machine)
    ▼
AWS APIs
```

**After Phase 2 (Lambda deployment):**
```
You (Claude Code CLI)  ←──── any other MCP client
    │  HTTP transport              │
    └──────────────┬───────────────┘
                   ▼
         API Gateway HTTP API
                   │
                   ▼
         Lambda function (MCP Server)
              IAM execution role
                   │
                   ▼
             AWS APIs
```

The server no longer runs on your machine. It lives in AWS, authenticated via a role, reachable from any HTTP client.

**After Phase 3 (Web UI):**
```
Browser
  │  HTTPS
  ▼
Next.js app (Vercel)
  │  POST /api/chat (server-side)
  ▼
Anthropic API ──── calls tools via mcp_servers ────▶ API Gateway → Lambda → AWS
  │  streaming response
  ▼
Browser (renders streamed tokens)
```

Claude Code still works via the Lambda endpoint. The web UI is an additional client surface.

**After Phase 4 (Briefing):**
```
EventBridge rule (cron: daily 9am)
  │
  ▼
Briefing Lambda
  ├── calls AWS SDK directly (EC2, CloudWatch, Lambda, Cost Explorer)
  ├── calls Anthropic API (synthesis prompt)
  └── posts to Slack webhook
```

**After Phase 5 (Multi-region):**
All existing tools accept an optional `region` parameter. New tools: `list_regions` and `cloudformation_status`.

---

## 3. Master IAM policy (all phases)

This is the cumulative least-privilege policy for all V2 phases. You can apply it all at once now, or add permissions phase by phase. Both approaches work; applying it in phases is more educational.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudOpsCopilotReadOnly",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances",
        "ec2:DescribeRegions",
        "logs:FilterLogEvents",
        "logs:DescribeLogGroups",
        "lambda:ListFunctions",
        "cloudwatch:GetMetricStatistics",
        "ce:GetCostAndUsage",
        "s3:ListAllMyBuckets",
        "s3:ListBucket",
        "s3:GetBucketLocation",
        "iam:ListUsers",
        "iam:GetLoginProfile",
        "iam:ListMFADevices",
        "cloudformation:DescribeStacks",
        "cloudformation:DescribeStackEvents",
        "health:DescribeEvents"
      ],
      "Resource": "*"
    }
  ]
}
```

> `health:DescribeEvents` requires a Business or Enterprise support plan. Skip it if you're on the free tier — the tool won't work without it, but the rest will.

---

## 4. Phase 1 — Tool expansion (Week 1)

**Goal:** Add three new tools using the pattern you already know. No architectural changes. By the end, the server has 7 tools across 6 AWS services.

**Why first.** Phase 2 requires you to refactor your tools into a shared registration module. Doing that with 7 tools instead of 4 means you practice the pattern more, and the V2 server is richer from the moment it deploys.

---

### New tools overview

#### 4.1 `browse_s3`

| Field | Value |
|---|---|
| Purpose | List S3 buckets and browse objects within a bucket by prefix |
| AWS APIs | `ListBuckets`, `ListObjectsV2` |
| Inputs | `bucketName` (optional string), `prefix` (optional string), `maxItems` (number, default 50) |
| Output | If no bucket: list of bucket names. If bucket given: objects under that prefix. |
| IAM | `s3:ListAllMyBuckets`, `s3:ListBucket`, `s3:GetBucketLocation` |
| New package | `@aws-sdk/client-s3` |

**Key learning: pagination.** `ListObjectsV2` returns a `NextContinuationToken` when more objects exist. Pass it back as `ContinuationToken` on the next call. Loop until the response has no continuation token. This pattern repeats in virtually every AWS API:

```typescript
let objects: S3Object[] = [];
let continuationToken: string | undefined;

do {
  const res = await s3.send(new ListObjectsV2Command({
    Bucket: bucketName,
    Prefix: prefix,
    MaxKeys: 100,
    ContinuationToken: continuationToken,
  }));
  objects.push(...(res.Contents ?? []));
  continuationToken = res.NextContinuationToken;
} while (continuationToken && objects.length < maxItems);
```

---

#### 4.2 `iam_audit`

| Field | Value |
|---|---|
| Purpose | List IAM users with their last-activity date and whether MFA is enabled |
| AWS APIs | `ListUsers`, `GetLoginProfile` (checks console access), `ListMFADevices` |
| Inputs | none |
| Output | Username, created date, last used, has console access, MFA enabled |
| IAM | `iam:ListUsers`, `iam:GetLoginProfile`, `iam:ListMFADevices` |
| New package | `@aws-sdk/client-iam` |

**Key learning: fan-out calls.** `ListUsers` gives you a list, but the MFA and login profile data requires a separate call per user. You'll do these in parallel with `Promise.all`. This is the standard pattern for enriching a list with per-item detail:

```typescript
const users = await iam.send(new ListUsersCommand({}));

const enriched = await Promise.all(
  (users.Users ?? []).map(async (user) => {
    const [mfaRes, profileRes] = await Promise.allSettled([
      iam.send(new ListMFADevicesCommand({ UserName: user.UserName })),
      iam.send(new GetLoginProfileCommand({ UserName: user.UserName })),
    ]);
    return {
      name: user.UserName,
      mfaEnabled: mfaRes.status === 'fulfilled' && (mfaRes.value.MFADevices?.length ?? 0) > 0,
      hasConsoleAccess: profileRes.status === 'fulfilled',
    };
  })
);
```

Note `Promise.allSettled` (not `Promise.all`) — `GetLoginProfile` throws a `NoSuchEntity` error for users without console access, which is normal. `allSettled` handles rejections gracefully instead of crashing.

---

#### 4.3 `aws_health` (conditional)

| Field | Value |
|---|---|
| Purpose | List open AWS Health events (service disruptions, scheduled maintenance) |
| AWS API | `DescribeEvents` |
| Inputs | `hoursBack` (number, default 24), `region` (optional) |
| Output | Event type, service, region, status, start time |
| IAM | `health:DescribeEvents` |
| New package | `@aws-sdk/client-health` |
| Requirement | AWS Business or Enterprise support plan |

> Check your support plan first: AWS Console → Support → Support Plans. If you're on the free/developer tier, skip this tool — the API call will fail with `SubscriptionRequiredException`. Add it later if you upgrade.

The Health API is **global** and lives in `us-east-1` only, like Cost Explorer. Hardcode that in the client regardless of your default region.

---

### Phase 1 file changes

New files:
```
src/tools/browseS3.ts
src/tools/iamAudit.ts
src/tools/awsHealth.ts        (only if Business support)
src/aws/clients.ts            (add S3Client, IAMClient, HealthClient)
```

In `src/index.ts`: add three `server.registerTool()` calls.

**Success criteria:** Claude Code answers all of these correctly:
- "What S3 buckets do I have?"
- "List the objects in my `<bucket>` bucket."
- "Do any of my IAM users have no MFA enabled?"
- "Are there any AWS Health events in the last 24 hours?" (if Health tool added)

---

## 5. Phase 2 — Deploy to AWS Lambda (Week 2)

**Goal:** Package the MCP server as a Lambda function, expose it via a Lambda Function URL, swap the transport from stdio to Streamable HTTP, and update Claude Code to connect via HTTP instead of spawning a local process.

**Why this is the most important phase.** Right now the server is tightly coupled to your machine and your terminal session. After this phase it runs in AWS permanently, can be reached by any MCP client, authenticates via an IAM role (no credentials in code or env files), and can be hit by the web UI you'll build in Phase 3. Almost everything else in V2 depends on this step.

---

### Step 5.1 — Refactor tools into a shared registration module

Right now all `server.registerTool()` calls are in `src/index.ts`. Both the stdio entry point and the new Lambda entry point need to register the same tools. Extract them into a shared function.

Create `src/tools/register.ts`:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listEc2, listEc2Schema } from './listEc2.js';
import { searchLogs, searchLogsSchema } from './searchLogs.js';
import { lambdaStatus, lambdaStatusSchema } from './lambdaStatus.js';
import { costSummary, costSummarySchema } from './costSummary.js';
import { browseS3, browseS3Schema } from './browseS3.js';
import { iamAudit } from './iamAudit.js';

export function registerAllTools(server: McpServer): void {
  server.registerTool('list_ec2', { title: 'List EC2 instances', description: '...', inputSchema: listEc2Schema }, listEc2);
  server.registerTool('search_logs', { title: 'Search CloudWatch logs', description: '...', inputSchema: searchLogsSchema }, searchLogs);
  server.registerTool('lambda_status', { title: 'Lambda status', description: '...', inputSchema: lambdaStatusSchema }, lambdaStatus);
  server.registerTool('cost_summary', { title: 'Cost summary', description: '...', inputSchema: costSummarySchema }, costSummary);
  server.registerTool('browse_s3', { title: 'Browse S3', description: '...', inputSchema: browseS3Schema }, browseS3);
  server.registerTool('iam_audit', { title: 'IAM audit', description: '...', inputSchema: {} }, iamAudit);
}
```

Update `src/index.ts` (your existing stdio entry) to import and call `registerAllTools(server)` instead of the inline registrations. Confirm it still works with Claude Code before moving on.

---

### Step 5.2 — Install Lambda dependencies

```bash
npm install express serverless-http
npm install -D @types/express esbuild
```

- **express:** HTTP server framework. The MCP Streamable HTTP transport integrates with it.
- **serverless-http:** adapts Express to Lambda's event/response model. One line of code turns your Express app into a Lambda handler.
- **esbuild:** bundler. Lambda can't run TypeScript directly or resolve `node_modules` across a filesystem; esbuild compiles everything into one JS file.

---

### Step 5.3 — Create the Lambda entry point

Create `src/lambda.ts`:

```typescript
import express from 'express';
import serverless from 'serverless-http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerAllTools } from './tools/register.js';

const app = express();
app.use(express.json({ limit: '10mb' }));

// Stateless MCP handler — a new server+transport is created per request.
// This is correct for Lambda: each invocation is independent.
app.all('/mcp', async (req, res) => {
  const server = new McpServer({ name: 'cloud-ops-copilot', version: '2.0.0' });
  registerAllTools(server);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
  });

  res.on('close', () => {
    transport.close();
    server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// Export the serverless-http handler — this is what Lambda calls
export const handler = serverless(app);
```

**Why stateless?** A persistent MCP server over stdio maintains one long-lived connection per client session. Lambda invocations are short-lived and independent. Stateless mode (`sessionIdGenerator: undefined`) means no session is maintained between requests — each tool call arrives, gets handled, and the function exits. This matches Lambda's execution model perfectly.

---

### Step 5.4 — Create the esbuild script

Create `build.mjs` at the project root:

```javascript
import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/lambda.ts'],
  bundle: true,          // inline all imports into one file
  platform: 'node',
  target: 'node20',
  format: 'cjs',         // Lambda requires CommonJS
  outfile: 'dist/index.js',
  // Bundle the AWS SDK too — don't rely on Lambda's bundled version
  // which may not match the modular v3 packages you're using
});

console.log('Build complete → dist/index.js');
```

Add to `package.json` scripts:

```json
"scripts": {
  "build": "node build.mjs",
  "start:stdio": "npx tsx src/index.ts",
  "start:lambda": "node dist/index.js"
}
```

Run the build and confirm it produces `dist/index.js` without errors:

```bash
npm run build
```

---

### Step 5.5 — Create the IAM execution role

A Lambda function needs a role that defines what AWS services it can call. This replaces the `AWS_PROFILE` + access key approach from V1 — the function authenticates as this role automatically, with no credentials in code or environment variables.

**In the AWS Console (logged in as your admin user):**

1. IAM → **Roles** → **Create role**
2. Trusted entity type: **AWS service**
3. Use case: **Lambda** → Next
4. Attach two policies:
   - `AWSLambdaBasicExecutionRole` (allows the function to write logs to CloudWatch — required for all Lambdas)
   - `CloudOpsCopilotReadOnly` (your custom policy from V1 / updated with V2 permissions)
5. Name: `cloud-ops-copilot-lambda-role`
6. Create role

Copy the **Role ARN** — you'll need it in the next step. It looks like `arn:aws:iam::123456789012:role/cloud-ops-copilot-lambda-role`.

---

### Step 5.6 — Create the Lambda function

**Zip the build output:**

```bash
cd dist
zip -r ../lambda-deploy.zip index.js
cd ..
```

On Windows PowerShell:
```powershell
Compress-Archive -Path dist/index.js -DestinationPath lambda-deploy.zip -Force
```

**In the AWS Console:**

1. Lambda → **Create function**
2. **Author from scratch**
3. Function name: `cloud-ops-copilot`
4. Runtime: **Node.js 20.x**
5. Architecture: x86_64
6. **Change default execution role** → Use an existing role → select `cloud-ops-copilot-lambda-role`
7. Create function

**Upload your code:**

On the function page → **Code** tab → **Upload from** → **.zip file** → upload `lambda-deploy.zip`.

**Set the handler:** In Code tab → Runtime settings → Edit → Handler: `index.handler` (matches the `export const handler` in your code).

**Set environment variables:** Configuration tab → Environment variables → Edit → Add:
- `AWS_REGION`: `us-east-1`

(You do not need `AWS_PROFILE` — the execution role handles authentication.)

**Increase the timeout:** Configuration tab → General configuration → Edit → Timeout: `30 seconds`. The default 3s is too short for calls that fan out across multiple AWS APIs.

**Set memory:** 256 MB is fine for this workload.

---

### Step 5.7 — Create a Lambda Function URL

A Function URL gives your Lambda an HTTPS endpoint without needing API Gateway.

On the Lambda function page → **Configuration** tab → **Function URL** → **Create function URL**.

- Auth type: **NONE** (for a portfolio project, public access is fine — your tools are read-only)
- CORS: Enable, allow origin `*`, allow headers `content-type, x-api-key`

Click **Save**. You'll get a URL like:
```
https://abcdef123456.lambda-url.us-east-1.on.aws/
```

Your MCP endpoint is: `https://abcdef123456.lambda-url.us-east-1.on.aws/mcp`

**Test it is alive:**

```bash
curl -X POST https://YOUR_FUNCTION_URL/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

You should get a JSON response back with `"result":{"protocolVersion":...}`. If you get a 200, the server is alive.

---

### Step 5.8 — Update Claude Code to use the Lambda endpoint

Now that the server is in the cloud, Claude Code connects via HTTP instead of spawning a local process.

Update your `.mcp.json` in the project root:

```json
{
  "mcpServers": {
    "cloud-ops-copilot": {
      "type": "http",
      "url": "https://YOUR_FUNCTION_URL/mcp"
    }
  }
}
```

No `command`, no `args`, no `env` block — the server is remote, Claude Code just sends HTTP requests to it.

Run `claude mcp list` to confirm it shows as connected, then ask "list my EC2 instances" to verify end-to-end.

---

### Step 5.9 — Deployment script for future updates

Every time you change tool code, you'll need to rebuild and redeploy. Create `deploy.sh` (or `deploy.ps1` on Windows):

```bash
#!/bin/bash
set -e
echo "Building..."
npm run build
echo "Zipping..."
cd dist && zip -r ../lambda-deploy.zip index.js && cd ..
echo "Deploying to Lambda..."
aws lambda update-function-code \
  --function-name cloud-ops-copilot \
  --zip-file fileb://lambda-deploy.zip \
  --profile your-admin-profile
echo "Done."
```

On Windows PowerShell:
```powershell
npm run build
Compress-Archive -Path dist/index.js -DestinationPath lambda-deploy.zip -Force
aws lambda update-function-code `
  --function-name cloud-ops-copilot `
  --zip-file fileb://lambda-deploy.zip `
  --profile your-admin-profile
```

**Phase 2 success criteria:**
- `claude mcp list` shows `cloud-ops-copilot` connected over HTTP (not stdio)
- All 7 tools respond correctly through the Lambda endpoint
- No AWS credentials anywhere in your code or `.mcp.json`
- The `./src/index.ts` stdio entry point still works locally if needed

---

## 6. Phase 3 — Web UI (Week 3)

**Goal:** A Next.js chat app that lets any browser user ask natural-language questions about your infrastructure, backed by the Anthropic API (which calls your Lambda MCP server to get live data). Deploy it publicly so you have a shareable URL.

**Why Vercel over AWS Amplify.** Vercel created Next.js and has zero-config deployment for it. Amplify works, but adds configuration overhead (build settings, IAM roles for Amplify, branch mappings) that distracts from the actual learning here. The real AWS work in this phase is the Lambda endpoint — that's already built. Use Vercel; get the UI live faster.

---

### Step 6.1 — Create the Next.js project

```bash
npx create-next-app@latest cloud-ops-ui
cd cloud-ops-ui
```

When prompted:
- TypeScript: Yes
- ESLint: Yes
- Tailwind CSS: Yes
- App Router: Yes
- Import alias: default (`@/`)

Install Anthropic SDK:
```bash
npm install @anthropic-ai/sdk
```

---

### Step 6.2 — The API route (server-side)

This is the most important file. It runs **on the server** (never in the browser), keeps your Anthropic API key secret, and calls the Anthropic API with your Lambda MCP server attached.

Create `app/api/chat/route.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { NextRequest } from 'next/server';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(req: NextRequest) {
  const { messages } = await req.json();

  // Tell the Anthropic API to use your deployed MCP server as a tool source.
  // Anthropic's infrastructure calls your Lambda endpoint when tools are needed.
  const stream = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    stream: true,
    mcp_servers: [
      {
        type: 'url',
        url: process.env.MCP_SERVER_URL!,  // your Lambda Function URL + /mcp
        name: 'cloud-ops-copilot',
      },
    ],
    system:
      'You are a cloud ops assistant. You have access to tools that query live AWS infrastructure. ' +
      'When asked about instances, logs, costs, or Lambda functions, use the appropriate tool. ' +
      'Summarize results in plain language. Keep answers concise.',
    messages,
  });

  // Stream the response back to the browser as Server-Sent Events
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          controller.enqueue(encoder.encode(event.delta.text));
        }
      }
      controller.close();
    },
  });

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
```

---

### Step 6.3 — The chat UI

Replace `app/page.tsx` with a minimal but complete chat interface:

```tsx
'use client';
import { useState, useRef, useEffect } from 'react';

type Message = { role: 'user' | 'assistant'; content: string };

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    if (!input.trim() || loading) return;
    const userMessage: Message = { role: 'user', content: input };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    // Append empty assistant message that we'll stream into
    setMessages((m) => [...m, { role: 'assistant', content: '' }]);

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: newMessages }),
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      setMessages((m) => {
        const updated = [...m];
        updated[updated.length - 1] = {
          role: 'assistant',
          content: updated[updated.length - 1].content + chunk,
        };
        return updated;
      });
    }
    setLoading(false);
  }

  return (
    <main className="flex flex-col h-screen max-w-2xl mx-auto p-4">
      <h1 className="text-xl font-bold mb-4">☁️ Cloud Ops Copilot</h1>
      <div className="flex-1 overflow-y-auto space-y-4 mb-4">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`p-3 rounded-lg text-sm whitespace-pre-wrap ${
              m.role === 'user'
                ? 'bg-blue-100 ml-8'
                : 'bg-gray-100 mr-8'
            }`}
          >
            <span className="font-semibold">
              {m.role === 'user' ? 'You' : 'Copilot'}:
            </span>{' '}
            {m.content}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="flex gap-2">
        <input
          className="flex-1 border rounded px-3 py-2 text-sm"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Ask about your AWS infrastructure..."
          disabled={loading}
        />
        <button
          onClick={send}
          disabled={loading}
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm disabled:opacity-50"
        >
          {loading ? '...' : 'Send'}
        </button>
      </div>
    </main>
  );
}
```

---

### Step 6.4 — Local environment variables

Create `cloud-ops-ui/.env.local`:

```
ANTHROPIC_API_KEY=sk-ant-...
MCP_SERVER_URL=https://YOUR_FUNCTION_URL/mcp
```

This file is gitignored by default in Next.js. Never commit it.

Run locally to confirm it works:
```bash
npm run dev
```

Open `http://localhost:3000` and ask "list my EC2 instances." You should see a streaming response.

---

### Step 6.5 — Deploy to Vercel

```bash
npm install -g vercel
vercel
```

Follow the prompts (link to a new project, auto-detects Next.js). After the first deploy, set environment variables in the Vercel dashboard:

**Vercel Dashboard → your project → Settings → Environment Variables:**
- `ANTHROPIC_API_KEY` → your key
- `MCP_SERVER_URL` → your Lambda Function URL + `/mcp`

Redeploy (or it picks up on next push). You now have a live public URL.

---

### Step 6.6 — Add simple auth (important)

Your web UI is public. Anyone who finds the URL can query your AWS infrastructure. Add a password gate before sharing the URL.

In `app/api/chat/route.ts`, add at the top of the handler:

```typescript
const apiKey = req.headers.get('x-api-key');
if (apiKey !== process.env.UI_API_KEY) {
  return new Response('Unauthorized', { status: 401 });
}
```

In `app/page.tsx`, add the key to the fetch call:
```typescript
headers: {
  'Content-Type': 'application/json',
  'x-api-key': process.env.NEXT_PUBLIC_UI_API_KEY ?? '',
},
```

Add `UI_API_KEY` and `NEXT_PUBLIC_UI_API_KEY` (same value) to `.env.local` and Vercel environment variables. The `NEXT_PUBLIC_` prefix exposes the key to the browser bundle — this is fine because it's a shared password, not a secret token.

**Phase 3 success criteria:**
- Live URL where a non-technical person can ask AWS questions
- Responses stream character-by-character
- URL + password shareable with anyone
- No AWS credentials or Anthropic key visible anywhere client-side

---

## 7. Phase 4 — Scheduled daily briefing (Week 4)

**Goal:** Every morning, a Lambda function wakes up automatically, queries your infrastructure, asks Claude to synthesize a summary, and posts it to a Slack channel.

---

### Step 7.1 — Create a Slack incoming webhook

1. Go to `api.slack.com/apps` → Create New App → From scratch
2. Name it `Cloud Ops Briefing`, pick your workspace
3. In the app settings → **Incoming Webhooks** → toggle on → **Add New Webhook to Workspace**
4. Pick the channel you want briefings in → Allow
5. Copy the webhook URL: `https://hooks.slack.com/services/T.../B.../...`

---

### Step 7.2 — Create the briefing Lambda

This is a **separate Lambda function** from your MCP server. It calls the AWS SDK directly (faster, no HTTP round-trip) and then calls the Anthropic API for synthesis.

Create a new directory alongside your MCP server project:

```
cloud-ops-briefing/
├── src/
│   └── index.ts
├── package.json
└── build.mjs
```

`src/index.ts`:

```typescript
import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import { LambdaClient, ListFunctionsCommand } from '@aws-sdk/client-lambda';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import Anthropic from '@anthropic-ai/sdk';

const region = process.env.AWS_REGION ?? 'us-east-1';
const ec2 = new EC2Client({ region });
const lambda = new LambdaClient({ region });
const cw = new CloudWatchClient({ region });
const ce = new CostExplorerClient({ region: 'us-east-1' });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const handler = async () => {
  // 1. Gather data in parallel
  const [instancesRes, functionsRes, costRes] = await Promise.allSettled([
    ec2.send(new DescribeInstancesCommand({})),
    lambda.send(new ListFunctionsCommand({})),
    ce.send(new GetCostAndUsageCommand({
      TimePeriod: {
        Start: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().split('T')[0],
        End: new Date().toISOString().split('T')[0],
      },
      Granularity: 'MONTHLY',
      Metrics: ['UnblendedCost'],
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
    })),
  ]);

  // 2. Summarize raw data
  const runningInstances = instancesRes.status === 'fulfilled'
    ? (instancesRes.value.Reservations ?? [])
        .flatMap(r => r.Instances ?? [])
        .filter(i => i.State?.Name === 'running').length
    : 'unavailable';

  const functionCount = functionsRes.status === 'fulfilled'
    ? functionsRes.value.Functions?.length ?? 0
    : 'unavailable';

  const topCost = costRes.status === 'fulfilled'
    ? (costRes.value.ResultsByTime?.[0]?.Groups ?? [])
        .sort((a, b) =>
          parseFloat(b.Metrics?.UnblendedCost?.Amount ?? '0') -
          parseFloat(a.Metrics?.UnblendedCost?.Amount ?? '0')
        )
        .slice(0, 3)
        .map(g => `${g.Keys?.[0]}: $${parseFloat(g.Metrics?.UnblendedCost?.Amount ?? '0').toFixed(2)}`)
        .join(', ')
    : 'unavailable';

  // 3. Ask Claude to synthesize
  const synthesis = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',  // cheaper for automated tasks
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `Write a concise daily AWS infrastructure briefing (3-4 bullet points, under 150 words total).
      
Data as of ${new Date().toDateString()}:
- Running EC2 instances: ${runningInstances}
- Lambda functions: ${functionCount}
- Top costs this month: ${topCost}

Keep it factual, highlight anything notable. Start each bullet with an emoji.`,
    }],
  });

  const briefingText = synthesis.content[0].type === 'text'
    ? synthesis.content[0].text
    : 'Briefing unavailable.';

  // 4. Post to Slack
  await fetch(process.env.SLACK_WEBHOOK_URL!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: `*☁️ Daily Cloud Ops Briefing — ${new Date().toDateString()}*\n\n${briefingText}`,
    }),
  });

  return { statusCode: 200, body: 'Briefing sent.' };
};
```

Build and deploy this as a second Lambda function named `cloud-ops-briefing`, using the same role (`cloud-ops-copilot-lambda-role`) since it needs the same read permissions. Add environment variables: `ANTHROPIC_API_KEY`, `SLACK_WEBHOOK_URL`, `AWS_REGION`.

---

### Step 7.3 — Set the EventBridge schedule

1. AWS Console → **EventBridge** → **Rules** → **Create rule**
2. Name: `cloud-ops-daily-briefing`
3. Rule type: **Schedule**
4. Schedule pattern: **Cron-based** → `0 9 * * ? *` (9am UTC every day)
   - Note: AWS EventBridge cron syntax has 6 fields, not 5. The `?` is required in either day-of-month or day-of-week.
5. Target: **Lambda function** → `cloud-ops-briefing`
6. Create rule

Test it immediately: on the rule detail page → **Test** to trigger it once manually. Check your Slack channel for the briefing message within 30 seconds.

**Phase 4 success criteria:**
- Manual trigger → briefing appears in Slack within 30 seconds
- Briefing includes all three data points (instances, Lambda count, top cost)
- The schedule fires at 9am UTC the next morning

---

## 8. Phase 5 — Multi-region + CloudFormation (Ongoing)

**Goal:** Let users query any AWS region, not just `us-east-1`. Add a CloudFormation stack status tool. These are polish/completeness improvements rather than new architectural layers.

---

### Step 8.1 — Region parameterization

The key change: AWS SDK clients are created per-region. Instead of a global `const ec2 = new EC2Client({ region })`, create clients on-demand in each tool handler:

```typescript
// src/aws/clients.ts — updated
import { EC2Client } from '@aws-sdk/client-ec2';

const DEFAULT_REGION = process.env.AWS_REGION ?? 'us-east-1';

// Global-only services: always us-east-1
const GLOBAL_REGION_ONLY = new Set(['ce', 'health', 'iam']);

export function getEC2Client(region = DEFAULT_REGION) {
  return new EC2Client({ region });
}
// Repeat for each service
```

Update each tool's Zod schema to add an optional `region` field:

```typescript
export const listEc2Schema = {
  stateFilter: z.string().optional().describe('...'),
  region: z.string().optional().describe(
    'AWS region to query, e.g. ap-southeast-1. Defaults to us-east-1.'
  ),
};
```

In the handler, use `getEC2Client(region)` instead of the shared global client.

---

### Step 8.2 — `list_regions` tool

Lets Claude tell the user what regions their infrastructure actually uses, rather than guessing.

```typescript
// Uses EC2's DescribeRegions which returns all enabled regions
const res = await ec2Client.send(new DescribeRegionsCommand({
  AllRegions: false,  // only regions enabled in your account
}));
```

IAM permission needed: `ec2:DescribeRegions` (already in the master policy above).

---

### Step 8.3 — `cloudformation_status` tool

| Field | Value |
|---|---|
| Purpose | List CloudFormation stacks and their deployment status |
| AWS APIs | `DescribeStacks`, `DescribeStackEvents` |
| Inputs | `stackName` (optional — if provided, show events for that stack), `region` (optional) |
| Output | Stack names, status (CREATE_COMPLETE, UPDATE_FAILED, etc.), last updated |
| IAM | `cloudformation:DescribeStacks`, `cloudformation:DescribeStackEvents` |
| New package | `@aws-sdk/client-cloudformation` |

The most useful output: highlight stacks in any non-`COMPLETE` status (UPDATE_IN_PROGRESS, ROLLBACK_IN_PROGRESS, etc.) since those indicate something needs attention.

**Phase 5 success criteria:**
- "List my EC2 instances in ap-southeast-1" works (if you have any there)
- "What regions am I using?" returns meaningful results
- "List my CloudFormation stacks" returns stack statuses

---

## 9. Cumulative project snapshot (after all 5 phases)

**What you've built:**

```
cloud-ops-copilot/         ← MCP server (your original V1 project, extended)
  src/
    index.ts               ← stdio entry (local dev / Claude Code)
    lambda.ts              ← Lambda entry (deployed)
    tools/
      register.ts          ← shared tool registration
      listEc2.ts
      searchLogs.ts
      lambdaStatus.ts
      costSummary.ts
      browseS3.ts
      iamAudit.ts
      awsHealth.ts
      listRegions.ts
      cloudformationStatus.ts
  build.mjs
  deploy.sh

cloud-ops-ui/              ← Next.js web app (Vercel)
  app/
    page.tsx               ← chat UI
    api/chat/route.ts      ← Anthropic API + MCP integration

cloud-ops-briefing/        ← scheduled Lambda (EventBridge)
  src/index.ts             ← daily briefing handler
```

**AWS services touched:** EC2, CloudWatch Logs, Lambda, Cost Explorer, S3, IAM, AWS Health, CloudFormation, API Gateway (or Function URLs), EventBridge, IAM Roles.

**Interfaces:** Claude Code CLI (stdio), Claude Code CLI (HTTP), any browser (web UI), Slack (push notifications).

---

## 10. Updated IAM policy for the Lambda execution role

The Lambda execution role needs the full V2 permissions. Update `cloud-ops-copilot-lambda-role` with the master policy from section 3. Also attach `AWSLambdaBasicExecutionRole` (for CloudWatch Logs write access — Lambda's own logs). The briefing Lambda uses the same role.

---

## 11. What the full arc looks like on a resume

After completing all five phases, you've moved through a complete progression: local dev tool → packaged Lambda service → full-stack web product → event-driven scheduled system → multi-region cloud-native application. Each phase is independently demonstrable with a concrete artifact: a CLI tool, a Lambda endpoint URL, a live web app URL, a daily Slack message, cross-region query results.

The single most important delivery action: **keep the web UI live** (Vercel free tier is free forever for hobby projects). A URL you can open in an interview is worth ten GitHub repos.
