import { describe, expect, it } from 'vitest';
import { SseParser } from '../src/shared/sse.js';

describe('SseParser', () => {
  it('parses events split across chunks, comments, multi-line data and CRLF', () => {
    const p = new SseParser();
    expect(p.push('retry: 3000\n\n:ping\n\ndata: {"a"')).toEqual([]);
    expect(p.push(':1}\nid: 7\n\nevent: container-event\r\ndata: x\r\ndata: y\r\n\r\n')).toEqual([
      { data: '{"a":1}', id: '7' },
      { event: 'container-event', data: 'x\ny' },
    ]);
  });

  it('rejects unbounded lines', () => {
    const p = new SseParser(10);
    expect(() => p.push('data: 0123456789abc')).toThrow('too long');
  });
});
