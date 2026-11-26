/** Speech-to-text with the browser's Web Speech API (Chrome, Edge, Safari; not Firefox). */

interface RecognitionResult {
  isFinal: boolean;
  0: {transcript: string};
}

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: {resultIndex: number; results: ArrayLike<RecognitionResult>}) => void) | null;
  onerror: ((event: {error: string}) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionConstructor = new () => Recognition;

const Recognition: RecognitionConstructor | undefined =
  typeof window === 'undefined'
    ? undefined
    : (window as unknown as {SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor})
        .SpeechRecognition ??
      (window as unknown as {webkitSpeechRecognition?: RecognitionConstructor}).webkitSpeechRecognition;

export const listenSupported = !!Recognition;

const MESSAGES: Record<string, string> = {
  'not-allowed': 'Microphone access was blocked. Allow it in the browser’s site settings.',
  'service-not-allowed': 'Speech recognition is not allowed in this browser.',
  'audio-capture': 'No microphone was found.',
  network: 'Speech recognition needs a network connection.',
};

export interface Listening {
  stop(): void;
  abort(): void;
}

/**
 * Listens for one utterance. `onText` receives the transcript so far; `onDone`
 * the final text (empty if nothing was heard) when the speaker pauses or `stop()` is called.
 */
export function listen({onText, onDone, onError}: {
  onText: (text: string) => void;
  onDone: (text: string) => void;
  onError: (message: string) => void;
}): Listening {
  if (!Recognition) throw new Error('Speech recognition is not supported in this browser.');
  const recognition = new Recognition();
  recognition.lang = navigator.language;
  recognition.interimResults = true;
  recognition.continuous = false;

  let finalText = '';
  let failed = false;
  recognition.onresult = event => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) finalText += result[0].transcript;
      else interim += result[0].transcript;
    }
    onText((finalText + interim).trim());
  };
  recognition.onerror = event => {
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    failed = true;
    onError(MESSAGES[event.error] ?? `Speech recognition failed (${event.error}).`);
  };
  recognition.onend = () => {
    if (!failed) onDone(finalText.trim());
  };
  recognition.start();
  return {
    stop: () => recognition.stop(),
    abort: () => {
      failed = true; // no onDone after an abort
      recognition.abort();
    },
  };
}

export interface ContinuousListening {
  stop(): void;
  /** Forget everything heard so far, including a phrase still being spoken. */
  clear(): void;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Hands-free listening: the transcript accumulates (starting from `initialText`), and when a
 * finished phrase ends with `sendWord` (e.g. "… over"), the text before it is sent.
 * Browsers end recognition sessions after a while, so it restarts until `stop()`.
 */
export function listenContinuously({sendWord, initialText = '', onText, onSend, onError}: {
  sendWord: string;
  initialText?: string;
  onText: (text: string) => void;
  onSend: (text: string) => void;
  onError: (message: string) => void;
}): ContinuousListening {
  if (!Recognition) throw new Error('Speech recognition is not supported in this browser.');
  const ending = new RegExp(`(?:^|[\\s,.;:!?])${escape(sendWord.trim())}[\\s.,;:!?…]*$`, 'i');

  let pending = initialText.trim(); // finished phrases not yet sent
  let stopped = false;
  let current: Recognition | null = null;
  let quickEnds = 0;

  const join = (a: string, b: string) => [a, b.trim()].filter(Boolean).join(' ');

  const start = () => {
    if (stopped) return;
    const recognition = new Recognition();
    recognition.lang = navigator.language;
    recognition.interimResults = true;
    recognition.continuous = true;
    const startedAt = Date.now();

    recognition.onresult = event => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result.isFinal) {
          interim += result[0].transcript;
          continue;
        }
        pending = join(pending, result[0].transcript);
        const match = ending.exec(pending);
        if (match) {
          const message = pending.slice(0, match.index).trim();
          pending = '';
          onText('');
          if (message) onSend(message);
        }
      }
      onText(join(pending, interim));
    };
    recognition.onerror = event => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      stopped = true;
      onError(MESSAGES[event.error] ?? `Speech recognition failed (${event.error}).`);
    };
    recognition.onend = () => {
      current = null;
      if (stopped) return;
      // Restart; back off if sessions keep ending immediately (e.g. the device is busy).
      quickEnds = Date.now() - startedAt < 1000 ? quickEnds + 1 : 0;
      if (quickEnds >= 5) {
        stopped = true;
        onError('The microphone keeps stopping. Hands-free listening was paused.');
        return;
      }
      setTimeout(start, quickEnds ? 500 * quickEnds : 0);
    };
    current = recognition;
    recognition.start();
  };

  start();
  return {
    stop() {
      stopped = true;
      current?.abort();
    },
    clear() {
      pending = '';
      onText('');
      // The session still holds the unfinished phrase; replace it with a fresh one.
      const old = current;
      if (!old || stopped) return;
      old.onresult = null;
      old.onerror = null;
      old.onend = () => {
        current = null;
        start();
      };
      old.abort();
    },
  };
}
