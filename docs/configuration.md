# Configuration

All configuration is environment variables. Invalid values stop the server at startup with a message
naming the variable.

| Variable            | Default | Meaning                                                                         |
| ------------------- | ------- | ------------------------------------------------------------------------------- |
| `DATA_DIR`          | `/data` | Directory with the YAML files. Must exist. Mount it read-only.                  |
| `PORT`              | `8080`  | Listen port.                                                                    |
| `KUMA_URL`          | unset   | Uptime Kuma base URL. Unset disables health.                                    |
| `KUMA_API_KEY_FILE` | unset   | File containing a Kuma API key. Unset means `/metrics` is fetched without auth. |
| `DOZZLE_URL`        | unset   | Dozzle hub base URL. Unset disables logs.                                       |
| `LOG_LEVEL`         | `info`  | `info`, `warn` or `error`. Logs are JSON lines on stdout/stderr.                |

## Uptime Kuma

`/api/health` reads Kuma's Prometheus `/metrics` on demand and caches the result for 30 s. After an
error it retries after 10 s, then 20 s, then every 30 s while Kuma stays down. Uptime Kuma 2.0 or newer is required, because older versions have no `monitor_id` label.
Kuma 2.5 also provides uptime ratios (`1d`, `30d`, `365d`), which the Health tab shows. Set
`KUMA_API_KEY_FILE` only if `/metrics` requires auth. The key is sent as the basic-auth password and
the file is re-read on every fetch, so rotation needs no restart. When Kuma is down or the key file is
missing, `/api/health` returns `{"error": "..."}` and the page keeps working.

Monitors in the data link to Kuma by `kuma_id`. A service's health is the worst status of its
monitors (`monitors[].service` or `services[].health.kuma`). A node's health combines its own
monitors (`monitors[].node`, e.g. a host ping) with the worst status of everything inside it.

## Dozzle

`DOZZLE_URL` is the root of the Dozzle hub (v11 API). For `services[].logs.dozzle: {host, container}`:

- `host` is the Dozzle host name: the agent's `DOZZLE_HOSTNAME`, or its Docker engine name.
- `container` is the container name.

The proxy reads host ids from the hub page and container ids from the hub's event stream. It then
sends the last `tail` lines (at most 500) and follows live, until the client disconnects (the
upstream request is then closed). Limits: only containers declared in the data, 8 concurrent streams,
50 lines/s per stream (500 burst; skipped lines are reported), 8 KiB per line, and 30 s without data
from Dozzle ends the stream. ANSI escapes are stripped and lines are shown as text.

Before a line leaves the server, `src/server/redact.ts` masks likely secrets with `[redacted]`:

- values of `apikey`, `api_key`, `key`, `token`, `access_token`, `password`, `passwd`, `secret` and
  `auth`, in query strings, `name=value`, `name: value` and JSON (case-insensitive)
- `Authorization:` header values and `Bearer` tokens
- Telegram bot tokens
- URL credentials (`https://user:pass@`)

Redaction runs before truncation. It errs toward masking, so an ordinary value under one of those
names is hidden too.
