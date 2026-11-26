import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {McpServer} from '../config.ts';

/** A tool as offered to the model; `name` is `<server id>__<tool name>`. */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolResult {
  server: McpServer;
  tool: string;
  /** Text returned to the model. */
  text: string;
  isError: boolean;
  /** MCP structuredContent, used by plugin renderers (e.g. atlas's viewer `url`). */
  structured?: Record<string, unknown>;
}

/** The tools from every enabled MCP server, and a way to call them. */
export interface Toolbox {
  tools: ToolSpec[];
  call(name: string, args: unknown): Promise<ToolResult>;
}

const SEPARATOR = '__';
const clients = new Map<string, Promise<Client>>();

function connect(server: McpServer): Promise<Client> {
  let client = clients.get(server.url);
  if (!client) {
    client = (async () => {
      const c = new Client({name: 'guru', version: '0.1.0'});
      await c.connect(new StreamableHTTPClientTransport(new URL(server.url)));
      return c;
    })();
    // A failed connection is retried on the next turn.
    client.catch(() => clients.delete(server.url));
    clients.set(server.url, client);
  }
  return client;
}

function resultText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map(item => (item?.type === 'text' ? item.text : `[${item?.type ?? 'unknown'} content]`))
    .join('\n');
}

/** Connects to the servers and lists their tools. Unreachable servers are reported, not fatal. */
export async function loadToolbox(servers: McpServer[]): Promise<{toolbox: Toolbox; errors: string[]}> {
  const errors: string[] = [];
  const byName = new Map<string, {server: McpServer; tool: string}>();
  const tools: ToolSpec[] = [];

  await Promise.all(servers.map(async server => {
    try {
      const client = await connect(server);
      const {tools: listed} = await client.listTools();
      for (const tool of listed) {
        const name = `${server.id}${SEPARATOR}${tool.name}`;
        byName.set(name, {server, tool: tool.name});
        tools.push({name, description: tool.description ?? '', inputSchema: tool.inputSchema as Record<string, unknown>});
      }
    } catch (error) {
      clients.delete(server.url);
      errors.push(`${server.name} is unavailable (${error instanceof Error ? error.message : String(error)}).`);
    }
  }));

  const toolbox: Toolbox = {
    tools,
    async call(name, args) {
      const target = byName.get(name);
      if (!target) return {server: {id: '?', name: '?', url: ''}, tool: name, text: `Unknown tool ${name}.`, isError: true};
      try {
        const client = await connect(target.server);
        const result = await client.callTool({name: target.tool, arguments: (args ?? {}) as Record<string, unknown>});
        return {
          ...target,
          text: resultText(result.content),
          isError: result.isError === true,
          structured: result.structuredContent as Record<string, unknown> | undefined,
        };
      } catch (error) {
        return {...target, text: `Tool call failed: ${error instanceof Error ? error.message : String(error)}`, isError: true};
      }
    },
  };
  return {toolbox, errors};
}
