import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { listEc2, listEc2Schema } from "./tools/listEc2.js";
import { listLogGroupsSchema, listLogGroups } from "./tools/listLogGroups.js";
import { searchLogsSchema, searchLogs } from "./tools/searchLogs.js";
import dotenv from "dotenv";
import { lambdaStatus, lambdaStatusSchema } from "./tools/lambdaStatus.js";
import { costSummary, costSummarySchema } from "./tools/costSummary.js";
import { browseS3, browseS3Schema } from "./tools/browseS3.js";
dotenv.config();
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

server.registerTool(
    "list_log_groups",
    {
        title: "List log groups",
        description:
  "List CloudWatch log groups in the configured AWS region. Use when the user asks what logs are available or does not know the name of a log group before searching logs.",
        inputSchema: listLogGroupsSchema,
    },
    listLogGroups
);
server.registerTool(
    "search_logs",
    {
        title: "Search CloudWatch Logs",
        description:
            "Search CloudWatch log events within a specific log group for a text pattern over a recent time window. Use when the user wants to inspect application logs, Lambda logs, or troubleshoot errors.",
        inputSchema: searchLogsSchema,
    },
    searchLogs
);
server.registerTool(
    "lambda_status",
    {
        title: "Lambda status",
        description:
  "List AWS Lambda functions in the configured region along with their runtime, last modified timestamp, and recent error count. Use when the user asks about deployed Lambda functions, their health, or whether any functions have recently encountered errors.",
        inputSchema: lambdaStatusSchema,
    },
    lambdaStatus
);
server.registerTool(
    "cost_summary",
    {
        title: "Cost summary",
        description: 
    "Summarize AWS costs grouped by service for the current billing period. Use when the user asks about cloud spending, billing, monthly costs, or which AWS services are contributing to their bill.",
        inputSchema: costSummarySchema,
    },
    costSummary
);
server.registerTool(
    "browse_s3",
    {
        title: "Browse S3",
        description: 
    "List AWS S3 buckets and browse objects within a bucket by prefix. Use when the user ask for a list of objects in an S3 bucket or a list of buckets.",
        inputSchema: browseS3Schema,
    },
    browseS3
);
// stdio: Claude Code spawns this process and talks over stdin/stdout.
// CRITICAL: never console.log to stdout — it corrupts the protocol.
// Use console.error for any debug output.
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("cloud-ops-copilot MCP server running on stdio");