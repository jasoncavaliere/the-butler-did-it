import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getSpeechRecognition,
  readTranscript,
  type SpeechRecognitionCtor,
  type SpeechRecognitionLike,
} from './speechRecognition';

/**
 * One utterance from the browser's speech recognition (#116).
 *
 * `supported` says whether the browser has a recognizer at all, resolved once at
 * mount, so a caller can leave its mic out entirely when there is none.
 * `start(handlers)` listens for a single utterance: no continuous or interim
 * results, one alternative, US English. Each session reports exactly once -
 * `onTranscript` with a non-empty trimmed transcript, or `onFailure` for an
 * error, no match, an empty result, or a session that ended with nothing. The
 * browser fires `onend` after a result or an error, and only the first outcome
 * counts. `listening` is true from a successful start until that `onend`.
 *
 * Handlers are passed to `start` rather than to the hook, so a session always
 * calls the handlers it was started with. Unmounting aborts any live session and
 * drops its handlers, so a late browser event never reaches unmounted state.
 *
 * `ctor` is for tests: omitted, the recognizer comes from the browser global;
 * `null` means unsupported.
 */
export type SpeechCaptureHandlers = {
  onTranscript: (transcript: string) => void;
  onFailure: () => void;
};

export type SpeechCapture = {
  supported: boolean;
  listening: boolean;
  start: (handlers: SpeechCaptureHandlers) => void;
};

/** Detach a recognizer's handlers so nothing it fires later is heard. */
function detach(rec: SpeechRecognitionLike): void {
  rec.onresult = null;
  rec.onerror = null;
  rec.onnomatch = null;
  rec.onend = null;
}

export function useSpeechCapture(ctor?: SpeechRecognitionCtor | null): SpeechCapture {
  const [Recognition] = useState(() => (ctor === undefined ? getSpeechRecognition() : ctor));
  const [listening, setListening] = useState(false);
  const activeRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(
    () => () => {
      const rec = activeRef.current;
      activeRef.current = null;
      if (rec !== null) {
        detach(rec);
        rec.abort();
      }
    },
    [],
  );

  const start = useCallback(
    ({ onTranscript, onFailure }: SpeechCaptureHandlers) => {
      if (Recognition === null || activeRef.current !== null) {
        return;
      }

      const rec = new Recognition();
      rec.lang = 'en-US';
      rec.continuous = false;
      rec.interimResults = false;
      rec.maxAlternatives = 1;

      // Only the first outcome of a session counts.
      let settled = false;
      const fail = () => {
        if (!settled) {
          settled = true;
          onFailure();
        }
      };

      rec.onresult = (event) => {
        if (settled) {
          return;
        }
        settled = true;
        // One utterance only: stop listening as soon as something is heard.
        rec.stop();
        const transcript = readTranscript(event);
        if (transcript === '') {
          onFailure();
        } else {
          onTranscript(transcript);
        }
      };
      rec.onerror = fail;
      rec.onnomatch = fail;
      rec.onend = () => {
        // A new session can only start once this one has ended, so the active
        // recognizer is always this one here.
        activeRef.current = null;
        setListening(false);
        fail();
      };

      activeRef.current = rec;
      try {
        rec.start();
      } catch {
        // The browser refused to start (already started, not allowed): nothing
        // is listening, so report the miss and leave the mic ready.
        detach(rec);
        activeRef.current = null;
        fail();
        return;
      }
      setListening(true);
    },
    [Recognition],
  );

  return { supported: Recognition !== null, listening, start };
}
