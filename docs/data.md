# Data files

Rules for people and agents who edit the System Map data. The JSON Schema in
`schema/system-map.schema.json` has every field; this page covers what the schema cannot say.

## Files

- The server reads every `*.yaml` in `DATA_DIR` in lexical order, so a numeric prefix sets the
  order (`00-meta.yaml`, `10-infra.yaml`, ...). Dotfiles and other extensions are ignored.
- One file, normally the one with `meta`, declares `version: 1`. Other files may omit it; if they
  declare a version, it must be 1.
- Top-level lists (`nodes`, `services`, ...) concatenate across files. `meta` deep-merges; when two
  files set the same key, the later file wins and the app shows a warning.
- Limits: 200 files, 4 MiB per file, 16 MiB in total.

## Ids and references

- Every entity has an `id`: kebab-case (`a-z`, `0-9`, `-`), unique across all kinds. A service and a
  node cannot share an id.
- References use ids. These must point at the right kind:

  | Field                                                                                                      | Must reference |
  | ---------------------------------------------------------------------------------------------------------- | -------------- |
  | `nodes[].parent`, `mounts[].storage`                                                                       | a node         |
  | `nodes[].network`                                                                                          | a network      |
  | `services[].node`, `jobs[].node`                                                                           | a node         |
  | `services[].stack`                                                                                         | a stack        |
  | `services[].health.kuma[]`                                                                                 | a monitor      |
  | `monitors[].node`                                                                                          | a node         |
  | `routes[].target`, `monitors[].service`                                                                    | a service      |
  | `policies[].scope`, `procedures[].applies_to`, `backups[].from`, `history[].refs`, `open_questions[].refs` | any entity     |

- `services[].calls[].target` is an id or free text for something outside the model
  (`Telegram Bot API`, `api.cloudflare.com`). Free text that looks like an id (`wiki-dbb`) gets a
  warning, because it is probably a typo.

## Stacks and the Apps graph

The Apps graph groups services into boxes by stack. Stacks are optional: without any, apps are not
boxed.

```yaml
stacks:
  - { id: media, name: Media, color: violet, order: 2 }
  - { id: dashboards, name: Dashboards, color: amber, order: 1 }

services:
  - id: sonarr
    stack: media
    calls:
      - { target: prowlarr, via: http, purpose: Indexer search }
      - { target: route-requests, via: https } # lands on the route's target service
      - { target: TVDB API, via: https } # free text: an external card
  - id: homepage
    stack: dashboards
    calls:
      - { target: sonarr, via: http, purpose: Widget, kind: observe }
```

- `stacks[]`: `id`, `name` (box label, default the id), `color` (one of `gray`, `red`, `orange`,
  `amber`, `lime`, `green`, `teal`, `cyan`, `blue`, `indigo`, `violet`, `pink`; default: picked in
  turn), `order` (lower first; unset ones follow in file order). Boxes are placed in this order,
  left to right, then down; a small box may move up into a gap beside a taller one.
- `services[].stack`: a stack id. Services without one, or with an unknown one (an error), go in
  **Other**.
- `services[].calls[].kind`: `use` (default) or `observe`. Use `observe` for dashboards, monitors
  and the like that read another app; those edges are drawn faint and ignored by the layout, so a
  dashboard calling ten apps does not pull them into one column.
- A device or free-text target is drawn inside the stack that calls it most (on a tie, the
  earlier stack).
- A call's edge label is its `purpose`, else `via`, else `:port`. Fill `purpose` where it helps:
  calls with none of the three have no label.
- Free-text call targets that differ only in case or spacing (`Telegram API`, `telegram api`) are
  one external card.

## Derived edges

The server computes these; do not write them:

| Edge        | From             | To                              |
| ----------- | ---------------- | ------------------------------- |
| `contains`  | `nodes[].parent` | node                            |
| `runs-on`   | service          | `services[].node`               |
| `calls`     | service          | `calls[].target` (ids only)     |
| `routes-to` | route            | `routes[].target`               |
| `mounts`    | node             | `mounts[].storage`              |
| `monitors`  | monitor          | `monitors[].service` or `.node` |
| `backs-up`  | backup           | each `backups[].from`           |

## Problems

The app lists problems prominently, and `npm run validate` prints them.

| Code             | Severity | Effect                                                      |
| ---------------- | -------- | ----------------------------------------------------------- |
| `yaml`           | error    | The file is not loaded. The app keeps the last good model.  |
| `file`           | error    | The file could not be read or exceeded a limit.             |
| `schema`         | error    | That entity is dropped; the rest loads.                     |
| `duplicate-id`   | error    | The later definition is dropped.                            |
| `dangling-ref`   | error    | Unknown or wrong-kind reference; no edge is drawn.          |
| `unknown-key`    | warning  | The key is kept and shown, but the schema does not know it. |
| `merge-conflict` | warning  | A later file overrode a `meta` value.                       |

## Conventions

- `status`: `running` (default), `stopped`, `deliberately-stopped` (shown dimmed), `retired`
  (dimmed and hidden unless "show retired" is on).
- A monitor points at a `service`, or at a `node` for host pings (host, guests, cameras), or at
  neither (push monitors). Setting both is an error.
- `monitors[].active` defaults to true.
- Two calls from the same service to the same target are one edge in the Apps graph, with a count
  and both purposes.
- Markdown fields (`notes`, `rule`, `body`, `summary`, `restore`, `rollback`, `meta.conventions`)
  render without raw HTML. Links must be `http(s)`.
- Never put secret values in the data. `secrets[]` holds paths and purposes only.
