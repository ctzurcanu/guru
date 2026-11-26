import {useEffect, useRef, useState} from 'react';
import Markdown from 'react-markdown';
import {PROVIDERS} from './providers/index.ts';
import {credentialsFor, useSettings, type Settings} from './settings.ts';
import {clearConversation, loadConversation, saveConversation, type Conversation} from './store.ts';
import {SettingsDialog} from './ui/SettingsDialog.tsx';

const emptyConversation = (s: Settings): Conversation =>
  ({provider: s.provider, model: s.models[s.provider], messages: [], history: []});

export default function App() {
  const [settings, saveSettings, clearSettings] = useSettings();
  const [conversation, setConversation] = useState(() => emptyConversation(settings));
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const provider = PROVIDERS[settings.provider];
  const credentials = credentialsFor(settings);
  const busy = streaming !== null;

  useEffect(() => {
    loadConversation().then(saved => {
      if (saved && saved.provider === settings.provider && saved.model === settings.models[saved.provider]) {
        setConversation(saved);
      }
    });
    // Restore once on start; later setting changes are handled in applySettings.
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({block: 'end'});
  }, [conversation.messages.length, streaming]);

  const newChat = (s = settings) => {
    abort.current?.abort();
    setConversation(emptyConversation(s));
    setError('');
    clearConversation();
  };

  const applySettings = (next: Settings) => {
    saveSettings(next);
    // Provider-native history can't move between providers or (reliably) models.
    if (next.provider !== conversation.provider || next.models[next.provider] !== conversation.model) newChat(next);
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    if (!credentials) {
      setShowSettings(true);
      return;
    }
    const before = conversation;
    const session = provider.createSession(credentials, before.model, structuredClone(before.history));
    const controller = new AbortController();
    abort.current = controller;
    setDraft('');
    setError('');
    setConversation({...before, messages: [...before.messages, {role: 'user', text}]});
    setStreaming('');

    try {
      const reply = await session.send(text, {
        signal: controller.signal,
        onText: delta => setStreaming(s => (s ?? '') + delta),
      });
      const next: Conversation = {
        ...before,
        messages: [...before.messages, {role: 'user', text}, {role: 'assistant', text: reply}],
        history: session.history,
      };
      setConversation(next);
      saveConversation(next);
    } catch (e) {
      // Roll back the turn and give the text back, so it can be resent.
      setConversation(before);
      setDraft(text);
      if (!controller.signal.aborted) setError(provider.describeError(e));
    } finally {
      setStreaming(null);
      abort.current = null;
    }
  };

  return (
    <div className="app">
      <header>
        <h1>guru</h1>
        <span className="model">{provider.label} · {conversation.model}</span>
        <span className="spacer" />
        <button onClick={() => newChat()} disabled={!conversation.messages.length && !busy}>New chat</button>
        <button onClick={() => setShowSettings(true)}>Settings</button>
      </header>

      <main className="messages">
        {!conversation.messages.length && !busy && (
          <p className="empty">
            {credentials ? 'Ask anything.' : <>Enter the guru passphrase or your own {provider.label} API key in <button className="link" onClick={() => setShowSettings(true)}>Settings</button> to start.</>}
          </p>
        )}
        {conversation.messages.map((m, i) => (
          <div key={i} className={`message ${m.role}`}>
            {m.role === 'assistant' ? <Markdown>{m.text}</Markdown> : m.text}
          </div>
        ))}
        {busy && <div className="message assistant">{streaming ? <Markdown>{streaming}</Markdown> : <span className="typing">…</span>}</div>}
        {error && <p className="error" role="alert">{error}</p>}
        <div ref={bottom} />
      </main>

      <form className="composer" onSubmit={e => { e.preventDefault(); send(); }}>
        <textarea
          value={draft}
          rows={2}
          placeholder="Message guru"
          aria-label="Message"
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        {busy
          ? <button type="button" onClick={() => abort.current?.abort()}>Stop</button>
          : <button type="submit" className="primary" disabled={!draft.trim()}>Send</button>}
      </form>

      {showSettings && (
        <SettingsDialog
          settings={settings}
          onSave={applySettings}
          onClearAll={() => {
            newChat(clearSettings());
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
