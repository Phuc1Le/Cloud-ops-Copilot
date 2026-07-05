import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAllTools } from "./tools/register.js";
import dotenv from "dotenv";
dotenv.config();

const server = new McpServer({
    name: "cloud-ops-copilot",
    version: "0.1.0",
});

registerAllTools(server);

// stdio: Claude Code spawns this process and talks over stdin/stdout.
// CRITICAL: never console.log to stdout — it corrupts the protocol.
// Use console.error for any debug output.
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("cloud-ops-copilot MCP server running on stdio");
