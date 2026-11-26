import {PROXY_URL, type ProviderId} from '../config.ts';

/** Provider-native conversation history, serialisable as JSON. */
export type NativeHistory = unknown[];

export interface SendOptions {
  onText: (delta: string) => void;
  signal: AbortSignal;
}

/**
 * One conversation with one provider. The session owns its provider-native
 * history, so nothing is lost converting between formats (e.g. Claude's
 * thinking blocks or OpenAI's reasoning items, which must be sent back as-is).
 */
export interface ChatSession {
  /** Sends a user message and resolves with the full reply. History is only updated on success. */
  send(text: string, options: SendOptions): Promise<string>;
  readonly history: NativeHistory;
}

/** Either the guru passphrase (the proxy adds the owner's key) or the user's own API key. */
export type Credentials = {passphrase: string} | {apiKey: string};

export interface Provider {
  id: ProviderId;
  label: string;
  /** Model ids usable for chat, newest first. */
  listModels(credentials: Credentials): Promise<string[]>;
  createSession(credentials: Credentials, model: string, history?: NativeHistory): ChatSession;
  /** A readable message for an error thrown by this provider's SDK. */
  describeError(error: unknown): string;
}

/** SDK client options that route requests through guru-proxy. */
export function proxyOptions(credentials: Credentials, path: string) {
  return 'passphrase' in credentials
    // The SDKs require a key; the proxy replaces this placeholder with the owner's key.
    ? {apiKey: 'set-by-guru-proxy', baseURL: PROXY_URL + path, defaultHeaders: {'x-guru-pass': credentials.passphrase}}
    : {apiKey: credentials.apiKey, baseURL: PROXY_URL + path};
}

/** The proxy's own error message (e.g. a wrong passphrase), if the error came from the proxy. */
export function proxyMessage(body: unknown): string | undefined {
  const error = (body as {error?: {type?: string; message?: string}} | undefined)?.error;
  return error?.type === 'proxy_error' ? error.message : undefined;
}

export const SYSTEM_PROMPT =
  'You are guru, a helpful assistant. Answers may be read aloud, so keep them clear and concise.';
