export type ProviderId = 'anthropic' | 'openai';

/** guru-proxy Worker (worker/). A public address, not a secret; override with VITE_PROXY_URL for local dev. */
export const PROXY_URL: string = import.meta.env.VITE_PROXY_URL ?? 'https://guru-proxy.ctzurcanu.workers.dev';

/** Fallback models, used only when the provider's live model list can't be fetched. */
export const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-6.2-sol',
};

/** Built-in plugins: remote MCP servers that are enabled by default. */
export const BUILTIN_MCP_SERVERS = [
  {id: 'atlas', name: 'Atlas', url: 'https://human-atlas-connect.ctzurcanu.workers.dev/mcp'},
] as const;
