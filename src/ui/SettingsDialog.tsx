import {useEffect, useRef, useState} from 'react';
import {BUILTIN_MCP_SERVERS, DEFAULT_MODELS, type ProviderId} from '../config.ts';
import {PROVIDERS} from '../providers/index.ts';
import {credentialsFor, type AuthMode, type Settings} from '../settings.ts';

interface Props {
  settings: Settings;
  onSave: (settings: Settings) => void;
  onClearAll: () => void;
  onClose: () => void;
}

export function SettingsDialog({settings, onSave, onClearAll, onClose}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(settings);
  const [models, setModels] = useState<string[]>([]);
  const [modelError, setModelError] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  const id = draft.provider;
  const provider = PROVIDERS[id];
  const auth = draft.auth[id];
  const model = draft.models[id];
  const credentials = credentialsFor(draft);
  const credentialsKey = JSON.stringify(credentials ?? null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  // Load the provider's live model list; this also checks the passphrase or key.
  useEffect(() => {
    setModels([]);
    setModelError('');
    const current = JSON.parse(credentialsKey);
    if (!current) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      provider.listModels(current).then(
        list => !cancelled && setModels(list),
        error => !cancelled && setModelError(provider.describeError(error)),
      );
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [provider, credentialsKey]);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft(d => ({...d, [key]: value}));
  const setFor = <K extends 'auth' | 'keys' | 'models'>(key: K, value: Settings[K][ProviderId]) =>
    setDraft(d => ({...d, [key]: {...d[key], [d.provider]: value}}));

  const options = [...new Set([model, DEFAULT_MODELS[id], ...models])];

  return (
    <dialog ref={dialog} className="settings" onClose={onClose}>
      <form
        onSubmit={event => {
          event.preventDefault();
          onSave(draft);
          dialog.current?.close();
        }}
      >
        <h2>Settings</h2>

        <label>
          Provider
          <select value={id} onChange={e => set('provider', e.target.value as ProviderId)}>
            {Object.values(PROVIDERS).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>

        <fieldset className="auth">
          <legend>Access</legend>
          {(['guru', 'own'] as AuthMode[]).map(mode => (
            <label key={mode} className="radio">
              <input type="radio" name="auth" checked={auth === mode} onChange={() => setFor('auth', mode)} />
              {mode === 'guru' ? 'guru passphrase' : `My own ${provider.label} API key`}
            </label>
          ))}
        </fieldset>

        {auth === 'guru' ? (
          <label>
            Passphrase
            <input
              type="password"
              autoComplete="current-password"
              value={draft.passphrase}
              onChange={e => set('passphrase', e.target.value.trim())}
            />
          </label>
        ) : (
          <label>
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

        <label>
          Model
          <select value={model} onChange={e => setFor('models', e.target.value)}>
            {options.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        {modelError && <p className="error">{modelError}</p>}

        <fieldset className="auth">
          <legend>Plugins</legend>
          {BUILTIN_MCP_SERVERS.map(server => (
            <label key={server.id} className="radio">
              <input
                type="checkbox"
                checked={draft.plugins[server.id] ?? true}
                onChange={e => set('plugins', {...draft.plugins, [server.id]: e.target.checked})}
              />
              {server.name}
            </label>
          ))}
        </fieldset>

        <p className="hint">
          {auth === 'guru'
            ? 'The passphrase unlocks guru’s own key, which stays on the server.'
            : `Your key is stored only in this browser and is relayed to ${provider.label} by guru’s proxy without being kept.`}
          {' '}Changing provider or model starts a new chat.
        </p>

        <div className="actions">
          {confirmClear ? (
            <>
              <span>Delete keys and chat?</span>
              <button type="button" className="danger" onClick={() => { onClearAll(); dialog.current?.close(); }}>Delete</button>
              <button type="button" onClick={() => setConfirmClear(false)}>Keep</button>
            </>
          ) : (
            <button type="button" className="link" onClick={() => setConfirmClear(true)}>Clear all data</button>
          )}
          <span className="spacer" />
          <button type="button" onClick={() => dialog.current?.close()}>Cancel</button>
          <button type="submit" className="primary">Save</button>
        </div>
      </form>
    </dialog>
  );
}
