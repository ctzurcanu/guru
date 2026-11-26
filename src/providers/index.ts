import type {ProviderId} from '../config.ts';
import {anthropicProvider} from './anthropic.ts';
import {openaiProvider} from './openai.ts';
import type {Provider} from './types.ts';

export const PROVIDERS: Record<ProviderId, Provider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
};
