# Data files

Rules for people and agents who edit the System Map data. The JSON Schema in
`schema/system-map.schema.json` has every field; this page covers what the schema cannot say.

## Files

- The server reads every `*.yaml` in `DATA_DIR` in lexical order, so a numeric prefix sets the
  order (`00-meta.yaml`, `10-infra.yaml`, ...). Dotfiles and other extensions are ignored.
- Every file starts with `version: 1`.
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
  | `services[].health.kuma[]`                                                                                 | a monitor      |
  | `routes[].target`, `monitors[].service`                                                                    | a service      |
  | `policies[].scope`, `procedures[].applies_to`, `backups[].from`, `history[].refs`, `open_questions[].refs` | any entity     |

- `services[].calls[].target` is an id or free text for something outside the model
  (`Telegram Bot API`, `api.cloudflare.com`). Free text that looks like an id (`wiki-dbb`) gets a
  warning, because it is probably a typo.

## Derived edges

The server computes these; do not write them:

| Edge        | From             | To                          |
| ----------- | ---------------- | --------------------------- |
| `contains`  | `nodes[].parent` | node                        |
| `runs-on`   | service          | `services[].node`           |
| `calls`     | service          | `calls[].target` (ids only) |
| `routes-to` | route            | `routes[].target`           |
| `mounts`    | node             | `mounts[].storage`          |
| `monitors`  | monitor          | `monitors[].service`        |
| `backs-up`  | backup           | each `backups[].from`       |

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
- `monitors[].active` defaults to true.
- Markdown fields (`notes`, `rule`, `body`, `summary`, `restore`, `rollback`, `meta.conventions`)
  render without raw HTML. Links must be `http(s)`.
- Never put secret values in the data. `secrets[]` holds paths and purposes only.
