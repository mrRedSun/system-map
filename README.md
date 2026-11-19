# System Map

An interactive, read-only map of a self-hosted server. A directory of YAML files describes the
whole system (host, guests, services, routes, firewall, jobs, backups, history), and is the single
source of truth. System Map renders those files as a topology graph with detail panels, and overlays
live health from Uptime Kuma and live logs from Dozzle.

The app never writes to the data. People and agents edit the YAML; the map reloads on save.

## Architecture

One container runs a small Node 22 server ([Hono](https://hono.dev)). It serves the built SPA and a
read-only API.

```
DATA_DIR/*.yaml ──► loader (parse → merge → validate → references) ──► ModelStore ──► /api/model, /api/events
Uptime Kuma /metrics ──► health cache (30 s) ──► /api/health
Dozzle hub ──► log proxy (allowlisted containers only) ──► /api/logs/:host/:container
```

| Path                  | What it holds                                                           |
| --------------------- | ----------------------------------------------------------------------- |
| `src/shared/`         | zod schema (the data contract) and API types, used by server and client |
| `src/server/model/`   | YAML loader: parse, merge, validate, reference checks, derived edges    |
| `src/server/store.ts` | Reads `DATA_DIR`, watches it, keeps the last good model                 |
| `src/server/app.ts`   | HTTP routes, security headers, static SPA                               |
| `src/web/`            | Vite + React + Tailwind + shadcn/ui front end                           |
| `schema/`             | Generated JSON Schema for editor validation                             |
| `examples/`           | Small fictional dataset for development and tests                       |

### API (all `GET`)

| Endpoint                              | Returns                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------- |
| `/api/model`                          | Merged model, derived `edges`, `problems[]`, `sources`. Has an `ETag`; 304 on match.        |
| `/api/events`                         | SSE. Sends `event: model` with the current ETag on connect and on every change.             |
| `/api/health`                         | `{ "<kuma_id>": { status, name, ping?, uptime? } }`, plus `error` when Kuma is unreachable. |
| `/api/logs/:host/:container?tail=200` | SSE log stream for a container declared in `services[].logs.dozzle`.                        |
| `/api/me`                             | `Remote-User` / `Remote-Name` from the auth proxy, for display only.                        |
| `/healthz`                            | 200 once a model is loaded, 503 before.                                                     |
| `/schema/system-map.schema.json`      | The JSON Schema.                                                                            |

## Data

Read [docs/data.md](docs/data.md) before editing data files. In short:

- Every `*.yaml` file in `DATA_DIR` is read in lexical order (dotfiles are skipped). One file,
  normally the one with `meta`, declares `version: 1`; the others may omit it.
- Top-level lists concatenate across files. `meta` deep-merges, and a later file overriding a value
  produces a warning.
- Ids are kebab-case and unique across all kinds. References are by id.
- Unknown keys are kept and reported as warnings. Schema errors drop that one entity and report it
  with file and line.
- A YAML syntax error never takes the app down. The server keeps serving the last good model and
  shows the error.

Point your editor at the schema with a modeline at the top of each file:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/mrRedSun/system-map/main/schema/system-map.schema.json
```

Validate a data directory from the command line (exit 1 on errors; `--strict` also fails on warnings):

```sh
npm run validate -- path/to/data
docker run --rm -v "$PWD/data:/data:ro" ghcr.io/mrredsun/system-map:<tag> /app/validate.mjs
```

## Configuration

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

### Uptime Kuma

`/api/health` reads Kuma's Prometheus `/metrics` and caches the result for 30 s (10 s after an
error). Uptime Kuma 2.0 or newer is required, because older versions have no `monitor_id` label.
Kuma 2.5 also provides uptime ratios (`1d`, `30d`, `365d`), which the Health tab shows. Set
`KUMA_API_KEY_FILE` only if `/metrics` requires auth. The key is sent as the basic-auth password and
the file is re-read on every fetch, so rotation needs no restart. When Kuma is down or the key file is
missing, `/api/health` returns `{"error": "..."}` and the page keeps working.

Monitors in the data link to Kuma by `kuma_id`. A service's health is the worst status of its
monitors (`monitors[].service` or `services[].health.kuma`). A node's health combines its own
monitors (`monitors[].node`, e.g. a host ping) with the worst status of everything inside it.

### Dozzle

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

## Local development

Requires Node 22.12 or newer.

```sh
npm ci
npm run dev          # API on :8787 with DATA_DIR=examples, Vite on :5173 with a proxy to it
```

Open http://localhost:5173. Edit a file in `examples/` and the page updates.

## Tests and checks

```sh
npm run typecheck
npm run lint         # ESLint + Prettier
npm test             # Vitest: schema, merge, references, store, HTTP, topology, layout,
                     # search, markdown, Kuma parser/client, Dozzle proxy (fake upstream)
npm run schema:check # fails if schema/system-map.schema.json is stale (fix: npm run schema)
npm run build        # dist/public (SPA) + dist/server.mjs (bundled server)
```

CI (`.github/workflows/ci.yml`) runs all of these, `npm audit` on shipped dependencies, builds the
image, smoke-tests it read-only with dropped capabilities, and scans it with Trivy.

## Build and release

Only GitHub Actions builds and publishes images. On every push to `main`, after all checks pass, CI
pushes the exact image it tested to:

- `ghcr.io/mrredsun/system-map:sha-<full commit sha>` (immutable; deploy this)
- `ghcr.io/mrredsun/system-map:main` (moving alias)

The image is `linux/amd64`, runs as UID 65532 on a distroless Node 22 base with no shell, and needs
no writable paths.

## Deployment

Docker Compose is the deployment path. Start from [compose.example.yaml](compose.example.yaml).

1. Put the YAML files in `./data` next to `compose.yaml`.
2. Set the image to a `sha-<commit>` tag.
3. Put it behind the reverse proxy with authentication. The app has no login of its own. Do not
   publish its port directly.
4. `docker compose up -d`, then check `docker compose ps` (health) and `docker compose logs -f system-map`.

**Upgrade:** change the tag, `docker compose up -d`.
**Rollback:** set the previous `sha-<commit>` tag, `docker compose up -d`. The app keeps no state, so
rollback has no data step.
**Backup:** back up the data directory (ideally it is a Git repository). The container has nothing
else to back up.

## Security notes

- Authentication happens upstream (reverse proxy + SSO). `Remote-User` is shown, never trusted for
  decisions.
- Read-only API: non-GET methods get 405. The server never writes to `DATA_DIR`.
- Strict CSP (`default-src 'none'`, scripts and styles from self only). Fonts and icons are bundled;
  the page makes no third-party requests.
- Markdown renders without raw HTML. Links must be `http(s)`; the schema rejects other schemes.
- Data files hold secret _locations_ only, never values.
- Log streaming is limited to containers declared in the data, with caps on concurrent streams, line
  rate, and line length. Secrets in log lines are redacted on the server.

## Ownership

Maintained by the repository owner. Operational issues (data errors, Kuma or Dozzle connectivity) show
up in the app's Problems view and in the container logs.
