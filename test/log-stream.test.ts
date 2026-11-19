import { describe, expect, it } from 'vitest';
import { applyUpdates, INITIAL, MAX_LINES, updatesOf } from '../src/web/panel/log-stream.js';

const line = (text: string) => ({
  event: 'line',
  data: JSON.stringify({ ts: 1, level: 'info', stream: 'stdout', text }),
});

describe('log stream state', () => {
  it('turns SSE events into lines, notes and end states', () => {
    const now = () => 42;
    expect(updatesOf(line('hello'), now)).toEqual([
      { line: { ts: 1, level: 'info', stream: 'stdout', text: 'hello' } },
    ]);
    expect(updatesOf({ event: 'dropped', data: '{"count":3}' }, now)).toEqual([
      {
        line: {
          ts: 42,
          level: 'warn',
          stream: '',
          text: '… 3 lines skipped (rate limit)',
          note: true,
        },
      },
    ]);
    expect(updatesOf({ event: 'status', data: '{"message":"live"}' }, now)).toEqual([]);
    expect(
      updatesOf({ event: 'status', data: '{"message":"container started"}' }, now)[0],
    ).toMatchObject({
      line: { text: '— container started —', note: true },
    });
    expect(updatesOf({ event: 'error', data: '{"message":"boom"}' }, now)).toEqual([
      { state: 'error', message: 'boom' },
    ]);
    expect(updatesOf({ event: 'end', data: '{"message":"closed"}' }, now)).toEqual([
      { state: 'ended', message: 'closed' },
    ]);
  });

  it('ignores malformed events', () => {
    expect(updatesOf({ event: 'line', data: 'not json' })).toEqual([]);
    expect(updatesOf({ event: 'line', data: '{"text":1}' })).toEqual([]);
    expect(updatesOf({ event: 'mystery', data: '{}' })).toEqual([]);
  });

  it('applies a batch, keeps unique keys and caps the buffer', () => {
    const batch = Array.from({ length: MAX_LINES + 5 }, (_, i) => updatesOf(line(`l${i}`))[0]!);
    const state = applyUpdates({ ...INITIAL, state: 'live' }, batch);
    expect(state.lines).toHaveLength(MAX_LINES);
    expect(state.lines.at(-1)?.text).toBe(`l${MAX_LINES + 4}`);
    expect(new Set(state.lines.map((l) => l.key)).size).toBe(MAX_LINES);
    const ended = applyUpdates(state, [{ state: 'ended', message: 'bye' }]);
    expect(ended).toMatchObject({ state: 'ended', message: 'bye' });
    expect(ended.lines).toBe(state.lines);
  });
});
