import {useEffect, useRef, useState} from 'react';
import Markdown from 'react-markdown';
import {BUILTIN_MCP_SERVERS} from './config.ts';
import {loadToolbox} from './mcp/registry.ts';
import {PROVIDERS} from './providers/index.ts';
import {BASE_SYSTEM_PROMPT} from './providers/types.ts';
import {credentialsFor, useSettings, type Settings} from './settings.ts';
import {clearConversation, loadConversation, saveConversation, type ChatMessage, type Conversation} from './store.ts';
import {Eraser, ExternalLink, Eye, Mic, MicOff, SendHorizontal, Settings as SettingsIcon, Square, SquarePen, Volume2, VolumeX, X} from 'lucide-react';
import {IconButton} from './ui/IconButton.tsx';
import {SettingsDialog} from './ui/SettingsDialog.tsx';
import {listen, listenContinuously, listenSupported, type ContinuousListening, type Listening} from './voice/listen.ts';
import {createSpeaker, onSpeakingChange, speechSupported, stopSpeaking} from './voice/speak.ts';

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
  const [handsFreePaused, setHandsFreePaused] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const provider = PROVIDERS[settings.provider];
  const credentials = credentialsFor(settings);
  const busy = pending !== null;
  const view = pending?.view ?? selectedView ?? conversation.messages.findLast(m => m.view)?.view;
  const showPanel = !!view && view !== panelClosed;
  const handsFree = settings.handsFree && listenSupported;
  // Hands-free listens only while this page is visible, and not while guru answers or speaks.
  const handsFreeListening = handsFree && !handsFreePaused && visible && !busy && !speaking && !showSettings;

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

  useEffect(() => onSpeakingChange(setSpeaking), []);

  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  // The latest draft and send, for the hands-free listener's callbacks.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const sendRef = useRef<(text: string, spoken?: boolean) => void>(() => {});

  const handsFreeListener = useRef<ContinuousListening | null>(null);
  useEffect(() => {
    if (!handsFreeListening) return;
    const listener = (handsFreeListener.current = listenContinuously({
      sendWord: settings.sendWord,
      initialText: draftRef.current,
      onText: setDraft,
      onSend: text => sendRef.current(text, true),
      onError: message => {
        setHandsFreePaused(true);
        setError(message);
      },
    }));
    return () => {
      listener.stop();
      handsFreeListener.current = null;
    };
  }, [handsFreeListening, settings.sendWord]);

  const clearDraft = () => {
    setDraft('');
    handsFreeListener.current?.clear();
  };

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

  sendRef.current = send;

  const toggleMic = () => {
    if (handsFree) {
      if (handsFreePaused) {
        stopSpeaking();
        setError('');
      }
      setHandsFreePaused(p => !p);
      return;
    }
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
          <h1 className="logo"><img src={`${import.meta.env.BASE_URL}guru.svg`} alt="guru" width="36" height="36" /></h1>
          <span className="model" title={`${provider.label} · ${conversation.model}`}>{provider.label} · {conversation.model}</span>
          {speechSupported && (
            <IconButton
              icon={settings.speakReplies ? Volume2 : VolumeX}
              label={settings.speakReplies ? 'Voice on: replies are read aloud' : 'Voice off: replies are not read aloud'}
              className={settings.speakReplies ? 'on' : ''}
              aria-pressed={settings.speakReplies}
              onClick={() => {
                if (settings.speakReplies) stopSpeaking();
                saveSettings({...settings, speakReplies: !settings.speakReplies});
              }}
            />
          )}
          <IconButton icon={SquarePen} label="New chat" onClick={() => newChat()} disabled={!conversation.messages.length && !busy} />
          <IconButton icon={SettingsIcon} label="Settings" onClick={() => setShowSettings(true)} />
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
                <IconButton
                  icon={Eye}
                  label="Show this view"
                  showLabel
                  className="subtle"
                  onClick={() => { setSelectedView(m.view); setPanelClosed(undefined); }}
                />
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
            <IconButton
              icon={handsFree ? (handsFreePaused ? MicOff : Mic) : listening ? MicOff : Mic}
              label={handsFree
                ? handsFreePaused ? 'Resume hands-free listening' : 'Pause hands-free listening'
                : listening ? 'Stop listening' : 'Speak your message'}
              className={(handsFree ? handsFreeListening : listening) ? 'mic on' : 'mic'}
              aria-pressed={handsFree ? !handsFreePaused : !!listening}
              disabled={busy && !handsFree}
              onClick={toggleMic}
            />
          )}
          <textarea
            value={draft}
            rows={2}
            placeholder={handsFreeListening
              ? `Listening… end with “${settings.sendWord}” to send`
              : listening ? 'Listening…' : 'Message guru'}
            aria-label="Message"
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(draft);
              }
            }}
          />
          {draft && <IconButton icon={Eraser} label="Clear message" onClick={clearDraft} />}
          {busy
            ? <IconButton icon={Square} label="Stop" onClick={stopAll} />
            : <IconButton icon={SendHorizontal} label="Send" type="submit" className="primary" disabled={!draft.trim()} />}
        </form>
      </div>

      {showPanel && (
        <aside className="panel">
          <div className="panel-bar">
            <span>Atlas</span>
            <span className="spacer" />
            <a className="icon" href={view} target="_blank" rel="noreferrer" aria-label="Open in a new tab" title="Open in a new tab">
              <ExternalLink size={18} aria-hidden="true" />
            </a>
            <IconButton icon={X} label="Close panel" onClick={() => setPanelClosed(view)} />
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
