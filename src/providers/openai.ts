import OpenAI from 'openai';
import {MAX_TOOL_STEPS} from '../config.ts';
import {proxyMessage, proxyOptions, textJoiner, type ChatSession, type Credentials, type Provider} from './types.ts';

type InputItem = OpenAI.Responses.ResponseInputItem;

// Chat-capable families; excludes embeddings, audio, image, moderation, etc.
const CHAT_MODEL = /^(gpt-\d|o\d)/;
const NON_CHAT = /(audio|realtime|transcribe|tts|image|search|embedding|moderation|cyber)/;

function client(credentials: Credentials) {
  // Requests go through guru-proxy; no owner key is ever in the browser.
  return new OpenAI({...proxyOptions(credentials, '/openai/v1'), dangerouslyAllowBrowser: true});
}

/**
 * The SDK's stream helper adds client-side fields to output items (`parsed_arguments` on
 * function calls, `parsed` on output text). The API rejects them as input, so drop them.
 */
function asInput(item: InputItem): InputItem {
  const {parsed_arguments: _a, ...rest} = item as InputItem & {parsed_arguments?: unknown};
  if (rest.type === 'message' && Array.isArray(rest.content)) {
    return {...rest, content: rest.content.map(part => {
      const {parsed: _p, ...clean} = part as typeof part & {parsed?: unknown};
      return clean;
    })} as InputItem;
  }
  return rest as InputItem;
}

function parseArgs(raw: string): {args?: unknown; error?: string} {
  try {
    return {args: raw ? JSON.parse(raw) : {}};
  } catch {
    return {error: 'Invalid JSON arguments.'};
  }
}

export const openaiProvider: Provider = {
  id: 'openai',
  label: 'OpenAI',

  async listModels(credentials) {
    const models: OpenAI.Models.Model[] = [];
    for await (const model of client(credentials).models.list()) models.push(model);
    return models
      .filter(m => CHAT_MODEL.test(m.id) && !NON_CHAT.test(m.id))
      .sort((a, b) => b.created - a.created)
      .map(m => m.id);
  },

  createSession(credentials, model, initial = []) {
    const api = client(credentials);
    const items = initial as InputItem[];

    const session: ChatSession = {
      history: items,
      async send(text, {system, signal, onText, toolbox, onToolCall, onToolResult}) {
        // MCP schemas aren't written for OpenAI's strict mode, so it stays off.
        const tools: OpenAI.Responses.FunctionTool[] | undefined = toolbox?.tools.map(t => ({
          type: 'function',
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
          strict: false,
        }));
        const turn: InputItem[] = [{role: 'user', content: text}];
        const out = textJoiner(onText);

        for (let step = 0; ; step++) {
          out.step();
          const last = step === MAX_TOOL_STEPS - 1;
          const stream = api.responses.stream({
            model,
            instructions: system,
            input: [...items, ...turn].map(asInput), // also cleans conversations saved before this fix
            reasoning: {effort: 'low'}, // conversational turns: low latency matters most
            ...(tools?.length && {tools, tool_choice: last ? 'none' : 'auto'}),
            // Nothing is stored on OpenAI's side; reasoning is returned encrypted and sent back next turn.
            store: false,
            include: ['reasoning.encrypted_content'],
          }, {signal});

          for await (const event of stream) {
            if (event.type === 'response.output_text.delta') out.add(event.delta);
          }
          const response = await stream.finalResponse();
          if (response.error) throw new Error(response.error.message);
          turn.push(...(response.output as InputItem[]).map(asInput));

          const calls = response.output.filter(item => item.type === 'function_call');
          if (!calls.length || !toolbox) break;

          const outputs = await Promise.all(calls.map(async (call): Promise<InputItem> => {
            onToolCall?.(call.name);
            const {args, error} = parseArgs(call.arguments);
            if (error) return {type: 'function_call_output', call_id: call.call_id, output: `Error: ${error}`};
            const result = await toolbox.call(call.name, args);
            onToolResult?.(result);
            return {type: 'function_call_output', call_id: call.call_id, output: result.isError ? `Error: ${result.text}` : result.text};
          }));
          turn.push(...outputs);
        }

        items.push(...turn);
        return out.text;
      },
    };
    return session;
  },

  describeError(error) {
    const fromProxy = error instanceof OpenAI.APIError ? proxyMessage({error: error.error}) ?? proxyMessage(error.error) : undefined;
    if (fromProxy) return fromProxy;
    if (error instanceof OpenAI.AuthenticationError) return 'Invalid OpenAI API key.';
    if (error instanceof OpenAI.PermissionDeniedError) return 'This API key has no access to that model.';
    if (error instanceof OpenAI.NotFoundError) return 'Model not found.';
    if (error instanceof OpenAI.RateLimitError) return 'Rate limited by OpenAI. Try again shortly.';
    if (error instanceof OpenAI.APIConnectionError) return 'Could not reach OpenAI. Check your connection.';
    if (error instanceof OpenAI.APIError) return `OpenAI error ${error.status ?? ''}: ${error.message}`;
    return error instanceof Error ? error.message : String(error);
  },
};
