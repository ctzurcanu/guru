import {useCallback, useState} from 'react';
import {DEFAULT_MODELS, type ProviderId} from './config.ts';
import type {Credentials} from './providers/types.ts';

/** 'guru': the proxy uses the owner's key after the passphrase. 'own': the user's own API key. */
export type AuthMode = 'guru' | 'own';

export interface Settings {
  provider: ProviderId;
  auth: Record<ProviderId, AuthMode>;
  passphrase: string;
  keys: Record<ProviderId, string>;
  models: Record<ProviderId, string>;
}

/** Credentials for a provider, or undefined when none have been entered yet. */
export function credentialsFor(s: Settings, id: ProviderId = s.provider): Credentials | undefined {
  if (s.auth[id] === 'guru') return s.passphrase ? {passphrase: s.passphrase} : undefined;
  return s.keys[id] ? {apiKey: s.keys[id]} : undefined;
}

const STORAGE_KEY = 'guru.settings';

const DEFAULTS: Settings = {
  provider: 'anthropic',
  auth: {anthropic: 'guru', openai: 'guru'},
  passphrase: '',
  keys: {anthropic: '', openai: ''},
  models: {...DEFAULT_MODELS},
};

function load(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Settings>;
    return {
      provider: saved.provider ?? DEFAULTS.provider,
      auth: {...DEFAULTS.auth, ...saved.auth},
      passphrase: saved.passphrase ?? '',
      keys: {...DEFAULTS.keys, ...saved.keys},
      models: {...DEFAULTS.models, ...saved.models},
    };
  } catch {
    return DEFAULTS;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState(load);
  const save = useCallback((next: Settings) => {
    setSettings(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage blocked (e.g. private mode): settings still apply for this visit.
    }
  }, []);
  const clear = useCallback(() => {
    setSettings(DEFAULTS);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing stored.
    }
    return DEFAULTS;
  }, []);
  return [settings, save, clear] as const;
}
