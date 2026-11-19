/**
 * Masks credentials in log text before it leaves the server. Errs on the side of redacting:
 * a hidden harmless value is better than a leaked key.
 */
const R = '[redacted]';

/** Parameter / field names whose values are secrets (case-insensitive). */
const SECRET_NAMES = [
  'apikey',
  'api_key',
  'key',
  'token',
  'access_token',
  'password',
  'passwd',
  'secret',
  'auth',
];

const RULES: [RegExp, string | ((...m: string[]) => string)][] = [
  // URL userinfo: https://user:pass@host
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#@]*:[^\s/?#@]*@/gi, `$1${R}@`],
  // Authorization header with any scheme, e.g. "Authorization: Basic dXNlcjpwYXNz"
  [/\b(authorization["']?\s*[:=]\s*["']?)(?:[a-z]+\s+)?[^\s"',;]+/gi, `$1${R}`],
  // Bearer tokens anywhere
  [/\b(bearer)\s+[a-z0-9._~+/=-]+/gi, `$1 ${R}`],
  // Telegram bot tokens (also inside /bot<token>/ URLs)
  [/(?<!\d)\d{8,10}:[A-Za-z0-9_-]{30,}/g, R],
  // name=value, name: value, "name":"value" (query strings, logfmt, JSON, headers like X-Api-Key)
  [
    new RegExp(
      `(?<![A-Za-z0-9_])(${SECRET_NAMES.join('|')})(["']?\\s*[=:]\\s*["']?)(?!\\[redacted\\])[^\\s&;,"'<>(){}\\[\\]]+`,
      'gi',
    ),
    `$1$2${R}`,
  ],
];

export function redact(text: string): string {
  let out = text;
  for (const [re, replacement] of RULES) out = out.replace(re, replacement as string);
  return out;
}
