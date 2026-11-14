/**
 * The browser's speech recognition, feature-detected (#116).
 *
 * The hub's grocery mic uses the Web Speech API's `SpeechRecognition` (or
 * Chrome's prefixed `webkitSpeechRecognition`). TypeScript's DOM library ships
 * the event and result types but not the constructor or the recognizer
 * interface, so the small surface the hub uses is declared here.
 *
 * Like {@link initialBrowserOnline} this reads a browser global through a
 * `globalThis` cast rather than switching on the platform: on native and in Jest
 * neither global exists, so the mic is simply absent there.
 */

/** One recognized alternative: what the recognizer heard. */
export type SpeechAlternativeLike = { transcript?: string };

/** A recognition result event: a list of results, each a list of alternatives. */
export type SpeechResultEventLike = {
  resultIndex?: number;
  results?: ArrayLike<ArrayLike<SpeechAlternativeLike> | undefined>;
};

/** The part of a browser `SpeechRecognition` instance the hub uses. */
export type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onnomatch: ((event: unknown) => void) | null;
  onend: ((event: unknown) => void) | null;
};

/** The browser's `SpeechRecognition` constructor. */
export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/**
 * The browser's speech-recognition constructor, the standard name before the
 * webkit-prefixed one, or `null` when it exposes neither.
 */
export function getSpeechRecognition(globals: object = globalThis): SpeechRecognitionCtor | null {
  try {
    const scope = globals as {
      SpeechRecognition?: unknown;
      webkitSpeechRecognition?: unknown;
    };
    if (typeof scope.SpeechRecognition === 'function') {
      return scope.SpeechRecognition as SpeechRecognitionCtor;
    }
    if (typeof scope.webkitSpeechRecognition === 'function') {
      return scope.webkitSpeechRecognition as SpeechRecognitionCtor;
    }
    return null;
  } catch {
    return null;
  }
}

/** The trimmed transcript of the event's current result, or `''` when there is none. */
export function readTranscript(event: SpeechResultEventLike): string {
  const result = event.results?.[event.resultIndex ?? 0];
  const transcript = result?.[0]?.transcript;
  return typeof transcript === 'string' ? transcript.trim() : '';
}
