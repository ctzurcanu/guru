import {useEffect, useRef, useState} from 'react';
import Markdown from 'react-markdown';
import {BUILTIN_MCP_SERVERS} from './config.ts';
import {loadToolbox} from './mcp/registry.ts';
import {PROVIDERS} from './providers/index.ts';
import {BASE_SYSTEM_PROMPT} from './providers/types.ts';
import {credentialsFor, useSettings, type Settings} from './settings.ts';
import {clearConversation, loadConversation, saveConversation, type ChatMessage, type Conversation} from './store.ts';
import {SettingsDialog} from './ui/SettingsDialog.tsx';
import {listen, listenSupported, type Listening} from './voice/listen.ts';
import {createSpeaker, speechSupported, stopSpeaking} from './voice/speak.ts';

const emptyConversation = (s: Settings): Conversation =>
  ({provider: s.provider, model: s.models[s.provider], messages: [], history: []});

/** Live state of the assistant's reply while it's being produced. */
interface Pending {
  text: string;
  tools: string[];
  view?: string;
}

export default function App() {
  const [settings, saveSettings, clearSettings] = useSettings();
  const [conversation, setConversation] = useState(() => emptyConversation(settings));
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [listening, setListening] = useState<Listening | null>(null);
  const [panelClosed, setPanelClosed] = useState<string | undefined>();
  const [selectedView, setSelectedView] = useState<string | undefined>();
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const provider = PROVIDERS[settings.provider];
  const credentials = credentialsFor(settings);
  const busy = pending !== null;
  const view = pending?.view ?? selectedView ?? conversation.messages.findLast(m => m.view)?.view;
  const showPanel = !!view && view !== panelClosed;

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
  }, [conversation.messages.length, pending]);

  const stopAll = () => {
    abort.current?.abort();
    listening?.abort();
    stopSpeaking();
  };

  const newChat = (s = settings) => {
    stopAll();
    setConversation(emptyConversation(s));
    setSelectedView(undefined);
    setError('');
    setNotice('');
    clearConversation();
  };

  const applySettings = (next: Settings) => {
    saveSettings(next);
    // Provider-native history can't move between providers or (reliably) models.
    if (next.provider !== conversation.provider || next.models[next.provider] !== conversation.model) newChat(next);
  };

  const send = async (text: string, spoken = false) => {
    text = text.trim();
    if (!text || busy) return;
    if (!credentials) {
      setShowSettings(true);
      return;
    }
    stopSpeaking();
    const before = conversation;
    const controller = new AbortController();
    abort.current = controller;
    setDraft('');
    setError('');
    setNotice('');
    setConversation({...before, messages: [...before.messages, {role: 'user', text}]});
    // Mutated as the reply streams in; each change is mirrored to state for rendering.
    const live: Pending = {text: '', tools: []};
    const update = () => setPending({...live, tools: [...live.tools]});
    update();

    const speaker = spoken || settings.speakReplies ? createSpeaker() : null;
    const servers = BUILTIN_MCP_SERVERS.filter(s => settings.plugins[s.id] ?? true);

    try {
      const {toolbox, errors} = await loadToolbox(servers);
      if (errors.length) setNotice(errors.join(' '));
      const available = servers.filter(s => toolbox.tools.some(t => t.name.startsWith(s.id + '__')));
      const system = [BASE_SYSTEM_PROMPT, ...available.map(s => s.instructions ?? '')].filter(Boolean).join('\n\n');

      const session = provider.createSession(credentials, before.model, structuredClone(before.history));
      const reply = await session.send(text, {
        system,
        signal: controller.signal,
        toolbox: toolbox.tools.length ? toolbox : undefined,
        onText: delta => {
          speaker?.feed(delta);
          live.text += delta;
          update();
        },
        onToolCall: name => {
          const [id, tool] = name.split('__');
          const label = `${BUILTIN_MCP_SERVERS.find(s => s.id === id)?.name ?? id}: ${tool ?? name}`;
          live.tools.push(label);
          update();
        },
        onToolResult: result => {
          const url = result.structured?.url;
          if (!result.isError && typeof url === 'string') {
            live.view = url;
            setSelectedView(undefined);
            setPanelClosed(undefined);
            update();
          }
        },
      });
      speaker?.flush();

      const assistant: ChatMessage = {role: 'assistant', text: reply};
      if (live.tools.length) assistant.tools = live.tools;
      if (live.view) assistant.view = live.view;
      const next: Conversation = {
        ...before,
        messages: [...before.messages, {role: 'user', text}, assistant],
        history: session.history,
      };
      setConversation(next);
      setPending(null);
      saveConversation(next);
    } catch (e) {
      stopSpeaking();
      // Roll back the turn and give the text back, so it can be resent.
      setConversation(before);
      setDraft(text);
      setPending(null);
      if (!controller.signal.aborted) setError(provider.describeError(e));
    } finally {
      abort.current = null;
    }
  };

  const toggleMic = () => {
    if (listening) {
      listening.stop();
      return;
    }
    stopSpeaking();
    setError('');
    try {
      const session = listen({
        onText: setDraft,
        onDone: text => {
          setListening(null);
          if (text) send(text, true);
        },
        onError: message => {
          setListening(null);
          setError(message);
        },
      });
      setListening(session);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className={`app${showPanel ? ' with-panel' : ''}`}>
      <div className="chat">
        <header>
          <h1>guru</h1>
          <span className="model">{provider.label} · {conversation.model}</span>
          <span className="spacer" />
          {speechSupported && (
            <button
              className={settings.speakReplies ? 'on' : ''}
              aria-pressed={settings.speakReplies}
              title="Read every reply aloud"
              onClick={() => {
                if (settings.speakReplies) stopSpeaking();
                saveSettings({...settings, speakReplies: !settings.speakReplies});
              }}
            >
              {settings.speakReplies ? 'Voice on' : 'Voice off'}
            </button>
          )}
          <button onClick={() => newChat()} disabled={!conversation.messages.length && !busy}>New chat</button>
          <button onClick={() => setShowSettings(true)}>Settings</button>
        </header>

        <main className="messages">
          {!conversation.messages.length && !busy && (
            <p className="empty">
              {credentials
                ? 'Ask anything, or try “show me the C5 vertebra”.'
                : <>Enter the guru passphrase or your own {provider.label} API key in <button className="link" onClick={() => setShowSettings(true)}>Settings</button> to start.</>}
            </p>
          )}
          {conversation.messages.map((m, i) => (
            <div key={i} className={`message ${m.role}`}>
              {m.tools && <ToolTrace tools={m.tools} />}
              {m.role === 'assistant' ? <Markdown>{m.text}</Markdown> : m.text}
              {m.view && m.view !== view && (
                <button className="link" onClick={() => { setSelectedView(m.view); setPanelClosed(undefined); }}>Show this view</button>
              )}
            </div>
          ))}
          {pending && (
            <div className="message assistant">
              {pending.tools.length > 0 && <ToolTrace tools={pending.tools} />}
              {pending.text ? <Markdown>{pending.text}</Markdown> : <span className="typing">…</span>}
            </div>
          )}
          {notice && <p className="notice">{notice}</p>}
          {error && <p className="error" role="alert">{error}</p>}
          <div ref={bottom} />
        </main>

        <form className="composer" onSubmit={e => { e.preventDefault(); send(draft); }}>
          {listenSupported && (
            <button
              type="button"
              className={listening ? 'mic on' : 'mic'}
              aria-pressed={!!listening}
              disabled={busy}
              onClick={toggleMic}
              title={listening ? 'Stop listening' : 'Speak your message'}
            >
              {listening ? 'Listening…' : 'Mic'}
            </button>
          )}
          <textarea
            value={draft}
            rows={2}
            placeholder={listening ? 'Listening…' : 'Message guru'}
            aria-label="Message"
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(draft);
              }
            }}
          />
          {busy
            ? <button type="button" onClick={stopAll}>Stop</button>
            : <button type="submit" className="primary" disabled={!draft.trim()}>Send</button>}
        </form>
      </div>

      {showPanel && (
        <aside className="panel">
          <div className="panel-bar">
            <span>Atlas</span>
            <span className="spacer" />
            <a href={view} target="_blank" rel="noreferrer">Open</a>
            <button onClick={() => setPanelClosed(view)} aria-label="Close panel">Close</button>
          </div>
          <iframe
            key={view}
            src={view}
            title="Atlas 3D anatomy"
            allow="fullscreen; xr-spatial-tracking"
          />
        </aside>
      )}

      {showSettings && (
        <SettingsDialog
          settings={settings}
          onSave={applySettings}
          onClearAll={() => newChat(clearSettings())}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );

}

function ToolTrace({tools}: {tools: string[]}) {
  return <div className="tools">{tools.map((t, i) => <span key={i} className="tool">{t}</span>)}</div>;
}
