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
