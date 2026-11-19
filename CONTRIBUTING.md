# Contributing

Thanks for helping. Bug reports, data model ideas and pull requests are all welcome. Please keep
every example, issue and screenshot fictional: no real hostnames, IPs, domains, names or keys.

## Development setup

Requires Node 22.12 or newer.

```sh
npm ci
npm run dev        # API on :8787 (DATA_DIR=examples), Vite on :5173 with a proxy to it
npm run demo       # the built app on :8080 with the showcase data and mock Kuma + Dozzle
```

`npm run dev` reloads both the server and the page. Point it at other data with
`DATA_DIR=examples/showcase npm run dev`. The demo options are `--no-build`, `--docker [image]`,
`--port <n>` and `--data <dir>`.

## Project layout

| Path                              | What it holds                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------ |
| `src/shared/`                     | Data contract (`schema.ts`, Effect Schema), API payloads, `HttpApi`, SSE codec |
| `src/server/model/`               | YAML loader: parse, merge, validate, references, derived edges (pure)          |
| `src/server/`                     | Effect services (`DataStore`, `Health`, `Logs`), HTTP routes, entrypoint       |
| `src/web/`                        | React app: `lib/` (client, atoms), `graph/`, `panel/`, `views/`, `wiki/`       |
| `schema/`                         | Generated JSON Schema (do not edit by hand)                                    |
| `examples/`, `examples/showcase/` | Small test dataset, and the full fictional homelab for the demo                |
| `scripts/`                        | Schema generator, server bundler, demo, mocks, screenshots                     |
| `test/`                           | Vitest (`@effect/vitest` where effects are involved)                           |

[docs/architecture.md](docs/architecture.md) explains how the pieces fit together.

## Checks

```sh
npm run typecheck
npm run lint            # ESLint + Prettier (npm run format fixes formatting)
npm test
npm run schema:check
npm run build
npm run validate -- examples --strict
npm run validate -- examples/showcase --strict
```

CI runs the same checks, builds the image, smoke-tests it and scans it. A pull request needs a
green CI to merge.

## Screenshots

`npm run screenshots` boots the demo and writes `docs/screenshots/*.png` (fixed clock, viewport and
data, so unchanged UI gives unchanged files). It uses Playwright's Chromium (`npx playwright
install chromium`) or the browser in `CHROMIUM_PATH`. The **Screenshots** workflow in GitHub
Actions does the same and opens a pull request with the result.

## Changing the data model

1. Edit `src/shared/schema.ts` (and reference checks in `src/server/model/references.ts` if the
   field points at other entities).
2. `npm run schema` to regenerate `schema/system-map.schema.json`.
3. Update `examples/`, `examples/showcase/` and `docs/data.md`, and `SPEC`-level docs if the
   behaviour changes.
4. Both example directories must pass `npm run validate -- <dir> --strict`.
5. New fields stay optional so existing data keeps working.

## Commits and pull requests

- Branch names: `feat/…`, `fix/…`, `chore/…`, `docs/…`.
- Conventional commit style for titles, as in the history: `feat: add wiki pages`,
  `fix: keep the last good model on alias loops`, `docs: …`, `chore(deps): …`.
- Small, focused pull requests; squash-merged.

Before opening a pull request:

- [ ] Tests cover the change, and the checks above pass.
- [ ] UI changes include before/after screenshots.
- [ ] Schema changes follow the steps above.
- [ ] No real infrastructure data anywhere (code, examples, screenshots, description).

## Security

Report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md). Please do not open a
public issue for them.

## Code of conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
