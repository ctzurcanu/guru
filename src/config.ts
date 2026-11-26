export type ProviderId = 'anthropic' | 'openai';

/** guru-proxy Worker (worker/). A public address, not a secret; override with VITE_PROXY_URL for local dev. */
export const PROXY_URL: string = import.meta.env.VITE_PROXY_URL ?? 'https://guru-proxy.ctzurcanu.workers.dev';

/** Fallback models, used only when the provider's live model list can't be fetched. */
export const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-6.2-sol',
};

export interface McpServer {
  id: string;
  name: string;
  url: string;
  /** Added to the system prompt while the server is enabled. */
  instructions?: string;
}

/** Built-in plugins: remote MCP servers, enabled by default. */
export const BUILTIN_MCP_SERVERS: McpServer[] = [
  {
    id: 'atlas',
    name: 'Atlas',
    url: 'https://human-atlas-connect.ctzurcanu.workers.dev/mcp',
    instructions:
      'You can show human anatomy in 3D with the atlas tools. When the user asks to see or locate a body structure, ' +
      'call atlas__search_anatomy with a short term (e.g. "C5", "femur", "heart"), then atlas__show_anatomy with the exact ' +
      'id it returns. The view opens in a panel beside the chat, so never paste its URL or iframe; briefly say what is shown.',
  },
];

/** Safety cap on model ↔ tool round trips in one turn. */
export const MAX_TOOL_STEPS = 8;
