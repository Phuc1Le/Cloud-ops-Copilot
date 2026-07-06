import Anthropic from '@anthropic-ai/sdk';
import { NextRequest } from 'next/server';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(req: NextRequest) {
  const { messages } = await req.json();

  const stream = client.beta.messages.stream({
    model: 'claude-sonnet-5',
    max_tokens: 4096,
    betas: ['mcp-client-2025-11-20'],
    mcp_servers: [
      {
        type: 'url',
        url: process.env.MCP_SERVER_URL!,
        name: 'cloud-ops-copilot',
      },
    ],
    tools: [{ type: 'mcp_toolset', mcp_server_name: 'cloud-ops-copilot' }],
    system:
      'You are a cloud ops assistant. You have access to tools that query live AWS infrastructure. ' +
      'When asked about instances, logs, costs, or Lambda functions, use the appropriate tool. ' +
      'Summarize results in plain language. Keep answers concise.',
    messages,
  });

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
