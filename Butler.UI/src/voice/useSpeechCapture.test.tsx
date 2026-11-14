import { act, renderHook } from '@testing-library/react-native';

import type { SpeechRecognitionCtor, SpeechResultEventLike } from './speechRecognition';
import { useSpeechCapture } from './useSpeechCapture';

/**
 * A stand-in for the browser's recognizer. Every instance is recorded so a test
 * can fire its events and check how it was configured and driven.
 */
class FakeRecognition {
  static instances: FakeRecognition[] = [];
  static failStart = false;

  lang = '';
  continuous = true;
  interimResults = true;
  maxAlternatives = 0;
  onresult: ((event: SpeechResultEventLike) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onnomatch: ((event: unknown) => void) | null = null;
  onend: ((event: unknown) => void) | null = null;
  start = jest.fn(() => {
    if (FakeRecognition.failStart) {
      throw new Error('InvalidStateError');
    }
  });
  stop = jest.fn();
  abort = jest.fn();

  constructor() {
    FakeRecognition.instances.push(this);
  }

  result(transcript: string) {
    this.onresult?.({ resultIndex: 0, results: [[{ transcript }]] });
  }
  error() {
    this.onerror?.({ error: 'no-speech' });
  }
  noMatch() {
    this.onnomatch?.({});
  }
  end() {
    this.onend?.({});
  }
}

const Fake = FakeRecognition as unknown as SpeechRecognitionCtor;

function handlers() {
  return { onTranscript: jest.fn(), onFailure: jest.fn() };
}

function last(): FakeRecognition {
  return FakeRecognition.instances[FakeRecognition.instances.length - 1];
}

afterEach(() => {
  FakeRecognition.instances = [];
  FakeRecognition.failStart = false;
  delete (globalThis as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
});

describe('useSpeechCapture', () => {
  it('is unsupported when there is no recognizer, and start does nothing', async () => {
    const { result } = await renderHook(() => useSpeechCapture(null));
    const h = handlers();

    expect(result.current.supported).toBe(false);
    await act(async () => {
      result.current.start(h);
    });

    expect(result.current.listening).toBe(false);
    expect(h.onTranscript).not.toHaveBeenCalled();
    expect(h.onFailure).not.toHaveBeenCalled();
  });

  it('resolves the recognizer from the browser global when no ctor is given', async () => {
    const unsupported = await renderHook(() => useSpeechCapture());
    expect(unsupported.result.current.supported).toBe(false);

    (globalThis as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = FakeRecognition;
    const supported = await renderHook(() => useSpeechCapture());
    expect(supported.result.current.supported).toBe(true);
  });

  it('listens for one utterance, configured for a single final result', async () => {
    const { result } = await renderHook(() => useSpeechCapture(Fake));
    expect(result.current.supported).toBe(true);
    expect(result.current.listening).toBe(false);

    await act(async () => {
      result.current.start(handlers());
    });

    const rec = last();
    expect(rec.start).toHaveBeenCalledTimes(1);
    expect(rec.lang).toBe('en-US');
    expect(rec.continuous).toBe(false);
    expect(rec.interimResults).toBe(false);
    expect(rec.maxAlternatives).toBe(1);
    expect(result.current.listening).toBe(true);
  });

  it('reports a transcript once, stops, and is ready again after the session ends', async () => {
    const { result } = await renderHook(() => useSpeechCapture(Fake));
    const h = handlers();
    await act(async () => {
      result.current.start(h);
    });
    const rec = last();

    await act(async () => {
      rec.result('  oat milk ');
    });
    expect(h.onTranscript).toHaveBeenCalledWith('oat milk');
    expect(rec.stop).toHaveBeenCalledTimes(1);

    // A late second result and the closing end report nothing more.
    await act(async () => {
      rec.result('eggs');
      rec.end();
    });
    expect(h.onTranscript).toHaveBeenCalledTimes(1);
    expect(h.onFailure).not.toHaveBeenCalled();
    expect(result.current.listening).toBe(false);

    // A new start is a new session on a new recognizer.
    await act(async () => {
      result.current.start(handlers());
    });
    expect(FakeRecognition.instances).toHaveLength(2);
    expect(last().start).toHaveBeenCalledTimes(1);
  });

  it('ignores a second start while a session is live', async () => {
    const { result } = await renderHook(() => useSpeechCapture(Fake));
    await act(async () => {
      result.current.start(handlers());
    });
    await act(async () => {
      result.current.start(handlers());
    });

    expect(FakeRecognition.instances).toHaveLength(1);
  });

  it('reports an empty transcript as a failure', async () => {
    const { result } = await renderHook(() => useSpeechCapture(Fake));
    const h = handlers();
    await act(async () => {
      result.current.start(h);
    });

    await act(async () => {
      last().result('   ');
      last().end();
    });

    expect(h.onFailure).toHaveBeenCalledTimes(1);
    expect(h.onTranscript).not.toHaveBeenCalled();
    expect(result.current.listening).toBe(false);
  });

  it('reports an error once, though the browser also ends the session', async () => {
    const { result } = await renderHook(() => useSpeechCapture(Fake));
    const h = handlers();
    await act(async () => {
      result.current.start(h);
    });

    await act(async () => {
      last().error();
    });
    // Still listening until the browser ends the session.
    expect(result.current.listening).toBe(true);

    await act(async () => {
      last().end();
    });
    expect(h.onFailure).toHaveBeenCalledTimes(1);
    expect(result.current.listening).toBe(false);
  });

  it('reports no match as a failure', async () => {
    const { result } = await renderHook(() => useSpeechCapture(Fake));
    const h = handlers();
    await act(async () => {
      result.current.start(h);
    });

    await act(async () => {
      last().noMatch();
      last().end();
    });

    expect(h.onFailure).toHaveBeenCalledTimes(1);
  });

  it('reports a session that ends with nothing heard as a failure', async () => {
    const { result } = await renderHook(() => useSpeechCapture(Fake));
    const h = handlers();
    await act(async () => {
      result.current.start(h);
    });

    await act(async () => {
      last().end();
    });

    expect(h.onFailure).toHaveBeenCalledTimes(1);
    expect(result.current.listening).toBe(false);
  });

  it('reports a refused start as a failure and stays ready', async () => {
    FakeRecognition.failStart = true;
    const { result } = await renderHook(() => useSpeechCapture(Fake));
    const h = handlers();
    await act(async () => {
      result.current.start(h);
    });

    expect(h.onFailure).toHaveBeenCalledTimes(1);
    expect(result.current.listening).toBe(false);

    FakeRecognition.failStart = false;
    await act(async () => {
      result.current.start(handlers());
    });
    expect(FakeRecognition.instances).toHaveLength(2);
    expect(result.current.listening).toBe(true);
  });

  it('aborts a live session on unmount and ignores anything it fires later', async () => {
    const { result, unmount } = await renderHook(() => useSpeechCapture(Fake));
    const h = handlers();
    await act(async () => {
      result.current.start(h);
    });
    const rec = last();

    await unmount();

    expect(rec.abort).toHaveBeenCalledTimes(1);
    expect(rec.onresult).toBeNull();
    expect(rec.onend).toBeNull();
    expect(h.onFailure).not.toHaveBeenCalled();
  });

  it('unmounts cleanly with no live session', async () => {
    const { result, unmount } = await renderHook(() => useSpeechCapture(Fake));
    await act(async () => {
      result.current.start(handlers());
    });
    await act(async () => {
      last().result('eggs');
      last().end();
    });

    await unmount();

    expect(last().abort).not.toHaveBeenCalled();
  });
});
