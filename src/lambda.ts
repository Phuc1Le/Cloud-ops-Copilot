import express from 'express';
import serverless from 'serverless-http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerAllTools } from './tools/register.js';

const app = express();
app.use(express.json({ limit: '10mb' }));

// serverless-http's synthetic IncomingMessage never populates rawHeaders (it only
// sets req.headers), but the SDK's Node transport builds its Request from rawHeaders
// via @hono/node-server — so headers like Accept silently vanish before it sees them.
// Backfill rawHeaders from the parsed headers object to keep them in sync.
app.use((req, _res, next) => {
    if (!req.rawHeaders || req.rawHeaders.length === 0) {
        req.rawHeaders = Object.entries(req.headers).flatMap(([key, value]) =>
            Array.isArray(value) ? value.flatMap((v) => [key, v]) : [key, String(value ?? '')]
        );
    }
    next();
});

// Stateless MCP handler — a new server+transport is created per request.
// This is correct for Lambda: each invocation is independent.
app.all('/mcp', async (req, res) => {
    const server = new McpServer({ name: 'cloud-ops-copilot', version: '2.0.0' });
    registerAllTools(server);

    const transport = new StreamableHTTPServerTransport({});

    res.on('close', () => {
        transport.close();
        server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
});

// Export the serverless-http handler — this is what Lambda calls
export const handler = serverless(app);