import { getSpeechRecognition, readTranscript } from './speechRecognition';

/** Two distinct stand-in constructors, so a test can tell which one was picked. */
class Standard {}
class Webkit {}

describe('getSpeechRecognition', () => {
  it('returns null when the browser exposes neither SpeechRecognition nor webkitSpeechRecognition', () => {
    expect(getSpeechRecognition({})).toBeNull();
  });

  it('returns null from the real global scope, which has no recognizer under Jest', () => {
    expect(getSpeechRecognition()).toBeNull();
  });

  it('prefers the standard SpeechRecognition over the webkit-prefixed one', () => {
    expect(
      getSpeechRecognition({ SpeechRecognition: Standard, webkitSpeechRecognition: Webkit }),
    ).toBe(Standard);
  });

  it('falls back to webkitSpeechRecognition', () => {
    expect(getSpeechRecognition({ webkitSpeechRecognition: Webkit })).toBe(Webkit);
  });

  it('ignores a global that is not a constructor', () => {
    expect(getSpeechRecognition({ SpeechRecognition: {}, webkitSpeechRecognition: 'yes' })).toBeNull();
  });

  it('returns null when reading the global throws', () => {
    const hostile = {
      get SpeechRecognition(): unknown {
        throw new Error('blocked');
      },
    };
    expect(getSpeechRecognition(hostile)).toBeNull();
  });
});

describe('readTranscript', () => {
  it('returns the first alternative of the current result, trimmed', () => {
    expect(readTranscript({ resultIndex: 0, results: [[{ transcript: '  oat milk ' }]] })).toBe(
      'oat milk',
    );
  });

  it('reads the result at resultIndex', () => {
    expect(
      readTranscript({
        resultIndex: 1,
        results: [[{ transcript: 'eggs' }], [{ transcript: 'bread' }]],
      }),
    ).toBe('bread');
  });

  it('defaults to the first result when there is no resultIndex', () => {
    expect(readTranscript({ results: [[{ transcript: 'eggs' }]] })).toBe('eggs');
  });

  it("returns '' when there are no results, no result at the index, or no alternative", () => {
    expect(readTranscript({})).toBe('');
    expect(readTranscript({ resultIndex: 2, results: [[{ transcript: 'eggs' }]] })).toBe('');
    expect(readTranscript({ results: [[]] })).toBe('');
    expect(readTranscript({ results: [[{}]] })).toBe('');
  });
});
