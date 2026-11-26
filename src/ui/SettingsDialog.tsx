import {useEffect, useRef, useState, type ReactNode} from 'react';
import {
  AudioLines, Bot, Check, ChevronDown, CircleCheck, CircleX, Database, KeyRound, Loader, Puzzle, Trash, X,
  type LucideIcon,
} from 'lucide-react';
import {BUILTIN_MCP_SERVERS, DEFAULT_MODELS, type ProviderId} from '../config.ts';
import {PROVIDERS} from '../providers/index.ts';
import {credentialsFor, type AuthMode, type Settings} from '../settings.ts';
import {listenSupported} from '../voice/listen.ts';
import {speechSupported} from '../voice/speak.ts';
import {IconButton} from './IconButton.tsx';

interface Props {
  settings: Settings;
  onSave: (settings: Settings) => void;
  onClearAll: () => void;
  onClose: () => void;
}

type Section =
  | {kind: 'chat'}
  | {kind: 'provider'; id: ProviderId}
  | {kind: 'plugin'; id: string}
  | {kind: 'voice'}
  | {kind: 'data'};

const key = (s: Section) => ('id' in s ? `${s.kind}:${s.id}` : s.kind);

type Draft = [Settings, (update: (s: Settings) => Settings) => void];

export function SettingsDialog({settings, onSave, onClearAll, onClose}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(settings);
  const [section, setSection] = useState<Section>(
    credentialsFor(settings) ? {kind: 'chat'} : {kind: 'provider', id: settings.provider},
  );

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const state: Draft = [draft, update => setDraft(update)];
  const close = () => dialog.current?.close();

  return (
    <dialog ref={dialog} className="settings" onClose={onClose} aria-label="Settings">
      <form
        onSubmit={event => {
          event.preventDefault();
          onSave(draft);
          close();
        }}
      >
        <div className="settings-head">
          <h2>Settings</h2>
          <IconButton icon={X} label="Close settings" onClick={close} />
        </div>

        <div className="settings-body">
          <nav className="tree" aria-label="Settings sections">
            <ul role="tree">
              <TreeItem icon={Bot} label="Chat" section={{kind: 'chat'}} current={section} onSelect={setSection} />
              <TreeGroup icon={KeyRound} label="Providers">
                {Object.values(PROVIDERS).map(p => (
                  <TreeItem
                    key={p.id}
                    label={p.label}
                    section={{kind: 'provider', id: p.id}}
                    current={section}
                    onSelect={setSection}
                    badge={credentialsFor(draft, p.id) ? undefined : 'not set'}
                  />
                ))}
              </TreeGroup>
              <TreeGroup icon={Puzzle} label="Plugins">
                {BUILTIN_MCP_SERVERS.map(s => (
                  <TreeItem
                    key={s.id}
                    label={s.name}
                    section={{kind: 'plugin', id: s.id}}
                    current={section}
                    onSelect={setSection}
                    badge={draft.plugins[s.id] === false ? 'off' : undefined}
                  />
                ))}
              </TreeGroup>
              <TreeItem icon={AudioLines} label="Voice" section={{kind: 'voice'}} current={section} onSelect={setSection} />
              <TreeItem icon={Database} label="Data" section={{kind: 'data'}} current={section} onSelect={setSection} />
            </ul>
          </nav>

          <section className="detail" aria-live="polite">
            {section.kind === 'chat' && <ChatDetail state={state} onEditProvider={id => setSection({kind: 'provider', id})} />}
            {section.kind === 'provider' && <ProviderDetail key={section.id} id={section.id} state={state} />}
            {section.kind === 'plugin' && <PluginDetail id={section.id} state={state} />}
            {section.kind === 'voice' && <VoiceDetail state={state} />}
            {section.kind === 'data' && <DataDetail onClearAll={() => { onClearAll(); close(); }} />}
          </section>
        </div>

        <div className="actions">
          <span className="hint">Changing provider or model starts a new chat.</span>
          <span className="spacer" />
          <IconButton icon={X} label="Cancel" showLabel onClick={close} />
          <IconButton icon={Check} label="Save" showLabel type="submit" className="primary" />
        </div>
      </form>
    </dialog>
  );
}

function TreeGroup({icon: Icon, label, children}: {icon: LucideIcon; label: string; children: ReactNode}) {
  return (
    <li role="treeitem" aria-expanded="true" aria-selected="false" className="tree-group">
      <span className="tree-label">
        <ChevronDown size={14} aria-hidden="true" className="chevron" />
        <Icon size={16} aria-hidden="true" />
        {label}
      </span>
      <ul role="group">{children}</ul>
    </li>
  );
}

function TreeItem({icon: Icon, label, section, current, onSelect, badge}: {
  icon?: LucideIcon;
  label: string;
  section: Section;
  current: Section;
  onSelect: (s: Section) => void;
  badge?: string;
}) {
  const selected = key(section) === key(current);
  return (
    <li role="treeitem" aria-selected={selected}>
      <button type="button" className={selected ? 'tree-row selected' : 'tree-row'} onClick={() => onSelect(section)}>
        {Icon && <Icon size={16} aria-hidden="true" />}
        <span>{label}</span>
        {badge && <span className="badge">{badge}</span>}
      </button>
    </li>
  );
}

function Detail({title, children}: {title: string; children: ReactNode}) {
  return (
    <>
      <h3>{title}</h3>
      {children}
    </>
  );
}

function ChatDetail({state: [draft, setDraft], onEditProvider}: {state: Draft; onEditProvider: (id: ProviderId) => void}) {
  return (
    <Detail title="Chat">
      <fieldset className="choices">
        <legend>Answer with</legend>
        {Object.values(PROVIDERS).map(p => (
          <label key={p.id} className="choice">
            <input
              type="radio"
              name="provider"
              checked={draft.provider === p.id}
              onChange={() => setDraft(d => ({...d, provider: p.id}))}
            />
            <span>{p.label}</span>
            <span className="muted mono">{draft.models[p.id]}</span>
          </label>
        ))}
      </fieldset>
      {!credentialsFor(draft) && (
        <p className="hint">
          {PROVIDERS[draft.provider].label} has no access set yet.{' '}
          <button type="button" className="link" onClick={() => onEditProvider(draft.provider)}>Set it up</button>
        </p>
      )}
    </Detail>
  );
}

function ProviderDetail({id, state: [draft, setDraft]}: {id: ProviderId; state: Draft}) {
  const provider = PROVIDERS[id];
  const auth = draft.auth[id];
  const credentials = credentialsFor(draft, id);
  const credentialsKey = JSON.stringify(credentials ?? null);
  const [models, setModels] = useState<string[]>([]);
  const [check, setCheck] = useState<{status: 'idle' | 'checking' | 'ok' | 'error'; message?: string}>({status: 'idle'});

  // Load the live model list; this also checks the passphrase or key.
  useEffect(() => {
    const current = JSON.parse(credentialsKey);
    setModels([]);
    setCheck({status: current ? 'checking' : 'idle'});
    if (!current) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      provider.listModels(current).then(
        list => !cancelled && (setModels(list), setCheck({status: 'ok'})),
        error => !cancelled && setCheck({status: 'error', message: provider.describeError(error)}),
      );
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [provider, credentialsKey]);

  const setFor = <K extends 'auth' | 'keys' | 'models'>(field: K, value: Settings[K][ProviderId]) =>
    setDraft(d => ({...d, [field]: {...d[field], [id]: value}}));
  const model = draft.models[id];
  const options = [...new Set([model, DEFAULT_MODELS[id], ...models])];

  return (
    <Detail title={provider.label}>
      <fieldset className="choices">
        <legend>Access</legend>
        {(['guru', 'own'] as AuthMode[]).map(mode => (
          <label key={mode} className="choice">
            <input type="radio" name={`auth-${id}`} checked={auth === mode} onChange={() => setFor('auth', mode)} />
            <span>{mode === 'guru' ? 'guru passphrase' : `My own ${provider.label} API key`}</span>
          </label>
        ))}
      </fieldset>

      {auth === 'guru' ? (
        <label className="field">
          Passphrase
          <input
            type="password"
            autoComplete="current-password"
            value={draft.passphrase}
            onChange={e => {
              const passphrase = e.target.value.trim();
              setDraft(d => ({...d, passphrase}));
            }}
          />
        </label>
      ) : (
        <label className="field">
          {provider.label} API key
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={draft.keys[id]}
            placeholder={id === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
            onChange={e => setFor('keys', e.target.value.trim())}
          />
        </label>
      )}

      <Status check={check} />

      <label className="field">
        Model
        <select value={model} onChange={e => setFor('models', e.target.value)}>
          {options.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>

      <p className="hint">
        {auth === 'guru'
          ? 'The passphrase unlocks guru’s own key, which stays on the server. It is shared by all providers.'
          : `Your key is stored only in this browser and relayed to ${provider.label} by guru’s proxy without being kept.`}
      </p>
    </Detail>
  );
}

function Status({check}: {check: {status: string; message?: string}}) {
  if (check.status === 'checking') return <p className="status"><Loader size={16} className="spin" aria-hidden="true" /> Checking…</p>;
  if (check.status === 'ok') return <p className="status ok"><CircleCheck size={16} aria-hidden="true" /> Connected</p>;
  if (check.status === 'error') return <p className="status error"><CircleX size={16} aria-hidden="true" /> {check.message}</p>;
  return null;
}

function PluginDetail({id, state: [draft, setDraft]}: {id: string; state: Draft}) {
  const server = BUILTIN_MCP_SERVERS.find(s => s.id === id)!;
  const enabled = draft.plugins[id] ?? true;
  return (
    <Detail title={server.name}>
      <label className="choice">
        <input
          type="checkbox"
          checked={enabled}
          onChange={e => setDraft(d => ({...d, plugins: {...d.plugins, [id]: e.target.checked}}))}
        />
        <span>Enabled</span>
      </label>
      <p className="hint">Remote MCP server</p>
      <p className="mono small">{server.url}</p>
      {server.instructions && <p className="hint">{server.instructions}</p>}
    </Detail>
  );
}

function VoiceDetail({state: [draft, setDraft]}: {state: Draft}) {
  return (
    <Detail title="Voice">
      <label className="choice">
        <input
          type="checkbox"
          checked={draft.speakReplies}
          disabled={!speechSupported}
          onChange={e => setDraft(d => ({...d, speakReplies: e.target.checked}))}
        />
        <span>Read every reply aloud</span>
      </label>
      <p className="hint">Replies to spoken messages are always read aloud.</p>
      <p className={listenSupported ? 'status ok' : 'status error'}>
        {listenSupported ? <CircleCheck size={16} aria-hidden="true" /> : <CircleX size={16} aria-hidden="true" />}
        {listenSupported ? 'Microphone input is supported in this browser.' : 'This browser has no speech recognition (use Chrome, Edge or Safari).'}
      </p>
      {!speechSupported && <p className="status error"><CircleX size={16} aria-hidden="true" /> This browser can’t read text aloud.</p>}
    </Detail>
  );
}

function DataDetail({onClearAll}: {onClearAll: () => void}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <Detail title="Data">
      <p className="hint">Settings, keys, the passphrase and the current chat are stored only in this browser.</p>
      {confirm ? (
        <div className="row">
          <span>Delete keys, passphrase and chat?</span>
          <IconButton icon={Trash} label="Delete" showLabel className="danger" onClick={onClearAll} />
          <IconButton icon={X} label="Keep" showLabel onClick={() => setConfirm(false)} />
        </div>
      ) : (
        <IconButton icon={Trash} label="Clear all data" showLabel onClick={() => setConfirm(true)} />
      )}
    </Detail>
  );
}
