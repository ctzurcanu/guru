import OpenAI from 'openai';
import {SYSTEM_PROMPT, proxyMessage, proxyOptions, type ChatSession, type Credentials, type Provider} from './types.ts';

type InputItem = OpenAI.Responses.ResponseInputItem;

// Chat-capable families; excludes embeddings, audio, image, moderation, etc.
const CHAT_MODEL = /^(gpt-\d|o\d)/;
const NON_CHAT = /(audio|realtime|transcribe|tts|image|search|embedding|moderation|cyber)/;

function client(credentials: Credentials) {
  // Requests go through guru-proxy; no owner key is ever in the browser.
  return new OpenAI({...proxyOptions(credentials, '/openai/v1'), dangerouslyAllowBrowser: true});
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
      async send(text, {onText, signal}) {
        const request: InputItem[] = [...items, {role: 'user', content: text}];
        const stream = api.responses.stream({
          model,
          instructions: SYSTEM_PROMPT,
          input: request,
          reasoning: {effort: 'low'}, // conversational turns: low latency matters most
          // Nothing is stored on OpenAI's side; reasoning is returned encrypted and sent back next turn.
          store: false,
          include: ['reasoning.encrypted_content'],
        }, {signal});

        for await (const event of stream) {
          if (event.type === 'response.output_text.delta') onText(event.delta);
        }
        const response = await stream.finalResponse();
        if (response.error) throw new Error(response.error.message);

        items.push(request.at(-1)!, ...(response.output as InputItem[]));
        return response.output_text;
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
