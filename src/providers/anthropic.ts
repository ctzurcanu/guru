import Anthropic from '@anthropic-ai/sdk';
import {SYSTEM_PROMPT, proxyMessage, proxyOptions, type ChatSession, type Credentials, type Provider} from './types.ts';

type MessageParam = Anthropic.Beta.BetaMessageParam;

// Models that accept the server-side `fallbacks` parameter (re-run on another model after a refusal).
const FALLBACK_MODELS = new Set([
  'claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5',
]);

function client(credentials: Credentials) {
  // Requests go through guru-proxy; no owner key is ever in the browser.
  return new Anthropic({...proxyOptions(credentials, '/anthropic'), dangerouslyAllowBrowser: true});
}

export const anthropicProvider: Provider = {
  id: 'anthropic',
  label: 'Claude',

  async listModels(credentials) {
    const ids: string[] = [];
    for await (const model of client(credentials).models.list()) ids.push(model.id);
    return ids;
  },

  createSession(credentials, model, initial = []) {
    const api = client(credentials);
    const messages = initial as MessageParam[];

    const session: ChatSession = {
      history: messages,
      async send(text, {onText, signal}) {
        const request = [...messages, {role: 'user', content: text} satisfies MessageParam];
        const stream = api.beta.messages.stream({
          model,
          max_tokens: 64000,
          system: SYSTEM_PROMPT,
          messages: request,
          output_config: {effort: 'low'}, // conversational turns: low latency matters most
          ...(FALLBACK_MODELS.has(model) && {betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default'}),
        }, {signal});

        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') onText(event.delta.text);
        }
        const reply = await stream.finalMessage();
        if (reply.stop_reason === 'refusal') throw new Error('Claude declined to answer this request.');

        // Keep the full content (thinking blocks included) so later turns send it back unchanged.
        messages.push(request.at(-1)!, {role: 'assistant', content: reply.content});
        return reply.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('');
      },
    };
    return session;
  },

  describeError(error) {
    const fromProxy = error instanceof Anthropic.APIError ? proxyMessage(error.error) : undefined;
    if (fromProxy) return fromProxy;
    if (error instanceof Anthropic.AuthenticationError) return 'Invalid Anthropic API key.';
    if (error instanceof Anthropic.PermissionDeniedError) return 'This API key has no access to that model.';
    if (error instanceof Anthropic.NotFoundError) return 'Model not found.';
    if (error instanceof Anthropic.RateLimitError) return 'Rate limited by Anthropic. Try again shortly.';
    if (error instanceof Anthropic.APIConnectionError) return 'Could not reach Anthropic. Check your connection.';
    if (error instanceof Anthropic.APIError) return `Anthropic error ${error.status ?? ''}: ${error.message}`;
    return error instanceof Error ? error.message : String(error);
  },
};
