/** Reads streamed reply text aloud sentence by sentence, so speech starts before the reply ends. */

const SENTENCE_END = /([.!?…]["')\]]?\s+|\n+)/;

/** Markdown and code read badly aloud; keep only the words. */
function plain(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_#>|~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

// How many utterances are queued or playing; listeners hear when speaking starts and stops.
let queued = 0;
const listeners = new Set<(speaking: boolean) => void>();
const setQueued = (n: number) => {
  const was = queued > 0;
  queued = Math.max(0, n);
  if (was !== queued > 0) listeners.forEach(l => l(queued > 0));
};

/** Calls `listener` whenever guru starts or stops speaking. Returns an unsubscribe function. */
export function onSpeakingChange(listener: (speaking: boolean) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function createSpeaker() {
  let buffer = '';
  let inCode = false;

  const say = (text: string) => {
    const words = plain(text);
    if (!words || !speechSupported) return;
    const utterance = new SpeechSynthesisUtterance(words);
    utterance.lang = navigator.language;
    utterance.onend = utterance.onerror = () => setQueued(queued - 1);
    setQueued(queued + 1);
    speechSynthesis.speak(utterance);
  };

  return {
    /** Adds streamed text; complete sentences are spoken right away. */
    feed(delta: string) {
      buffer += delta;
      for (;;) {
        // Skip code blocks entirely.
        const fences = buffer.split('```');
        if (fences.length > 1) {
          if (!inCode) say(fences[0]);
          inCode = !inCode;
          buffer = fences.slice(1).join('```');
          continue;
        }
        if (inCode) return;
        const match = SENTENCE_END.exec(buffer);
        if (!match) return;
        const end = match.index + match[0].length;
        say(buffer.slice(0, end));
        buffer = buffer.slice(end);
      }
    },
    /** Speaks whatever is left once the reply is complete. */
    flush() {
      if (!inCode) say(buffer);
      buffer = '';
      inCode = false;
    },
  };
}

export function stopSpeaking() {
  if (speechSupported) speechSynthesis.cancel();
  setQueued(0);
}
