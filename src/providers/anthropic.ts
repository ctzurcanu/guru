import Anthropic from '@anthropic-ai/sdk';
import {MAX_TOOL_STEPS} from '../config.ts';
import {proxyMessage, proxyOptions, textJoiner, type ChatSession, type Credentials, type Provider} from './types.ts';

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
      async send(text, {system, signal, onText, toolbox, onToolCall, onToolResult}) {
        const tools = toolbox?.tools.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
        }));
        const turn: MessageParam[] = [{role: 'user', content: text}];
        const out = textJoiner(onText);

        for (let step = 0; ; step++) {
          out.step();
          const last = step === MAX_TOOL_STEPS - 1;
          const stream = api.beta.messages.stream({
            model,
            max_tokens: 64000,
            system,
            messages: [...messages, ...turn],
            output_config: {effort: 'low'}, // conversational turns: low latency matters most
            ...(tools?.length && {tools, tool_choice: {type: last ? 'none' : 'auto'}}),
            ...(FALLBACK_MODELS.has(model) && {betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default'}),
          }, {signal});

          for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') out.add(event.delta.text);
          }
          const reply = await stream.finalMessage();
          if (reply.stop_reason === 'refusal') throw new Error('Claude declined to answer this request.');

          // Keep the full content (thinking blocks included) so later turns send it back unchanged.
          turn.push({role: 'assistant', content: reply.content});

          const uses = reply.content.filter(block => block.type === 'tool_use');
          if (reply.stop_reason !== 'tool_use' || !uses.length || !toolbox) break;

          // Run this step's calls together and return all results in one message.
          const results = await Promise.all(uses.map(async use => {
            onToolCall?.(use.name);
            const result = await toolbox.call(use.name, use.input);
            onToolResult?.(result);
            return {type: 'tool_result' as const, tool_use_id: use.id, content: result.text, is_error: result.isError};
          }));
          turn.push({role: 'user', content: results});
        }

        messages.push(...turn);
        return out.text;
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
