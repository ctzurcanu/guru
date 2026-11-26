import type {ProviderId} from './config.ts';
import type {NativeHistory} from './providers/types.ts';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  /** Tools the assistant used for this reply, e.g. "Atlas: show_anatomy". */
  tools?: string[];
  /** Interactive view produced by a plugin (atlas viewer URL), shown in the side panel. */
  view?: string;
}

/** The current conversation: what's shown, plus the provider-native history sent to the API. */
export interface Conversation {
  provider: ProviderId;
  model: string;
  messages: ChatMessage[];
  history: NativeHistory;
}

const DB = 'guru';
const STORE = 'conversations';
const CURRENT = 'current';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = action(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

// Storage can be unavailable (private windows, blocked site data); chat still works without it.
export const loadConversation = () =>
  run<Conversation | undefined>('readonly', s => s.get(CURRENT)).catch(() => undefined);

export const saveConversation = (conversation: Conversation) =>
  run('readwrite', s => s.put(conversation, CURRENT)).catch(() => undefined);

export const clearConversation = () =>
  run('readwrite', s => s.delete(CURRENT)).catch(() => undefined);
