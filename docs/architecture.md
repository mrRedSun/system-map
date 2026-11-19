# Architecture

## Overview

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

## API (all `GET`)

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
