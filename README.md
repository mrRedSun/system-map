# System Map

An interactive, read-only map of a self-hosted server. A directory of YAML files describes the
whole system (host, guests, services, routes, firewall, jobs, backups, history), and is the single
source of truth. System Map renders those files as a graph with detail panels, and overlays live
health from Uptime Kuma and live logs from Dozzle.

The app never writes to the data. People and agents edit the YAML; the map reloads on save.

## Architecture

One container runs a small Node 22 server written with [Effect](https://effect.website) (v4). It
serves the built SPA and a read-only API. The front end is React, also on Effect for data and state.

```
DATA_DIR/*.yaml ──► loader (parse → merge → validate → references) ──► DataStore ──► /api/model, /api/events
Uptime Kuma /metrics ──► Health (on-demand cache) ──► /api/health
Dozzle hub ──► Logs (allowlisted containers only) ──► /api/logs/:host/:container
```

| Path                   | What it holds                                                                     |
| ---------------------- | --------------------------------------------------------------------------------- |
| `src/shared/schema.ts` | Effect `Schema` of the data contract; the source of the types and the JSON Schema |
| `src/shared/model.ts`  | Schemas of the API payloads (model, health, identity, log events)                 |
| `src/shared/api.ts`    | The JSON API as an `HttpApi`, implemented by the server and used by the client    |
| `src/server/model/`    | YAML loader: parse, merge, validate, reference checks, derived edges (pure)       |
| `src/server/store.ts`  | `DataSource` (reads and watches `DATA_DIR`) and `DataStore` (last good model)     |
| `src/server/kuma.ts`   | `Health`: Uptime Kuma metrics, cached                                             |
| `src/server/dozzle.ts` | `Logs`: Dozzle log proxy as an Effect `Stream`, with the stream limits            |
| `src/server/http.ts`   | Routes, security headers, SSE, static SPA                                         |
| `src/server/main.ts`   | Layer wiring and graceful shutdown                                                |
| `src/web/lib/`         | Typed API client and state as atoms (`effect/reactivity`, `@effect/atom-react`)   |
| `src/web/graph/`       | Graph transforms (plain functions) and React Flow views                           |
| `src/web/`             | Vite + React + Tailwind + shadcn/ui front end                                     |
| `schema/`              | Generated JSON Schema for editor validation                                       |
| `examples/`            | Small fictional dataset for development and tests                                 |

Server pieces are Effect services provided as layers (`AppConfig`, `DataSource`, `DataStore`,
`Health`, `Logs`), so tests swap any of them. The graph layout and topology code stays plain
TypeScript: it is synchronous and pure, and Effect would add nothing there.

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

## Graph

The graph has two modes, switched in its toolbar. The choice is remembered per browser and kept in
the URL (`#/graph/apps`, `#/graph/infra`, `#/graph/apps/n/<id>`).

- **Apps** (default): one card per service, grouped into boxes by `stack`, with `calls` as arrows
  from caller to callee. Each stack is laid out left to right (callers first); the boxes are packed
  to fit the screen. Calls to a route land on the route's target (the hostname is noted on the
  edge), calls to nodes show small device cards, and free-text targets show dashed external cards.
  Devices and externals sit in the stack that calls them most.
  `kind: observe` calls (dashboards, monitors) are drawn faint and do not affect the layout. A
  globe marks apps with a public route; hover a card for its ports and hostnames, hover an edge
  for its purpose. Selecting an app highlights its neighbours; **Focus** (`f`) hides the rest.
  Toolbar: external cards, ingress edges (reverse proxy → public apps), collapse/expand stacks,
  retired apps.
- **Infrastructure**: the containment tree (host → guests → services) with routes, mounts,
  monitors and backups.

The graph transforms (`src/web/graph/apps.ts`, `topology.ts`), the layout and the edge label
placement are pure functions with unit tests.

## Wiki

`#/wiki` turns the same data into readable pages: a home page with counts, current health, stacks,
articles and recent history; a page per stack (summary, how it works, a small Apps graph, its
apps); a page per app (where it runs, how to reach it, what it talks to and what uses it, health,
logs, backups and jobs, secret locations, rules, history, open questions); pages per machine and
per article; and index pages for policies, procedures, history, open questions and documentation
coverage (what still lacks a `summary`). Missing facts show as "not documented yet" hints. Pages
have breadcrumbs, a table of contents, permalinks (`#/wiki/<id>`) and print cleanly. The search
palette opens wiki pages while in the wiki, and the detail panel links to an entity's wiki page.

The wiki reads `summary` on apps, machines and stacks, `description` (markdown) on stacks, and the
hand-written `articles` list. In any markdown field, `[[id]]` links to an entity; an unknown id is
a validation error.

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

`/api/health` reads Kuma's Prometheus `/metrics` on demand and caches the result for 30 s. After an
error it retries after 10 s, then 20 s, then every 30 s while Kuma stays down. Uptime Kuma 2.0 or newer is required, because older versions have no `monitor_id` label.
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
npm test             # Vitest: schema, merge, references, store, HTTP, topology, apps graph,
                     # layout, edge labels, search, markdown, Kuma parser/client, Dozzle proxy
                     # (fake upstream)
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
