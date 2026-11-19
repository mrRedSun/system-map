import { describe, expect, it } from 'vitest';
import { lineText } from '../src/server/dozzle.js';
import { redact } from '../src/server/redact.js';

describe('redact', () => {
  it('masks secret query parameters, keeping the rest of the URL', () => {
    expect(
      redact(
        '[Info] Prowlarr: http://prowlarr:9696/1/api?t=search&apikey=0123456789abcdef0123456789abcdef&q=x',
      ),
    ).toBe('[Info] Prowlarr: http://prowlarr:9696/1/api?t=search&apikey=[redacted]&q=x');
    expect(redact('GET /api?API_KEY=abc&Token=def&access_token=ghi&key=jkl')).toBe(
      'GET /api?API_KEY=[redacted]&Token=[redacted]&access_token=[redacted]&key=[redacted]',
    );
  });

  it('masks key=value, key: value and JSON pairs', () => {
    expect(redact('login password=hunter2 user=bob')).toBe('login password=[redacted] user=bob');
    expect(redact('passwd: s3cr3t; secret = abc')).toBe('passwd: [redacted]; secret = [redacted]');
    expect(redact('{"apiKey":"abc123","name":"x","auth": "zzz"}')).toBe(
      '{"apiKey":"[redacted]","name":"x","auth": "[redacted]"}',
    );
    expect(redact('X-Api-Key: 9f8e7d')).toBe('X-Api-Key: [redacted]');
  });

  it('masks Authorization headers and bearer tokens', () => {
    expect(redact('Authorization: Bearer eyJhbGciOi.abc.def')).toBe('Authorization: [redacted]');
    expect(redact('authorization=Basic dXNlcjpwYXNz')).toBe('authorization=[redacted]');
    expect(redact('sending bearer abc.DEF-123 to upstream')).toBe(
      'sending bearer [redacted] to upstream',
    );
  });

  it('masks Telegram bot tokens, also inside bot URLs', () => {
    const token = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
    expect(redact(`token ${token} ok`)).toBe('token [redacted] ok');
    expect(redact(`POST https://api.telegram.org/bot${token}/sendMessage`)).toBe(
      'POST https://api.telegram.org/bot[redacted]/sendMessage',
    );
  });

  it('masks URL userinfo', () => {
    expect(redact('connect postgres://wiki:pa55@wiki-db:5432/wiki')).toBe(
      'connect postgres://[redacted]@wiki-db:5432/wiki',
    );
    expect(redact('https://user:pass@example.net/x')).toBe('https://[redacted]@example.net/x');
  });

  it('leaves ordinary text alone', () => {
    for (const s of [
      'monkey=1 keyboard=us tokens left: 5',
      'GET /page/42 200 ok in 12ms',
      'user@example.net logged in from 10.0.0.5',
      'time=12:30:45 level=info',
    ]) {
      expect(redact(s)).toBe(s);
    }
  });

  it('is idempotent', () => {
    const once = redact('apikey=abc Authorization: Bearer x https://u:p@h');
    expect(redact(once)).toBe(once);
  });

  it('runs before truncation in log lines', () => {
    const secret = 'a'.repeat(40);
    expect(lineText({ rm: `apikey=${secret}` }, 12)).toBe('apikey=[reda…');
    expect(lineText({ rm: `x=1 password=${secret}` })).toBe('x=1 password=[redacted]');
  });
});
