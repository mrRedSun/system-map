# Deployment and operations

## Deployment

Docker Compose is the deployment path. Start from [compose.example.yaml](../compose.example.yaml).

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

## Build and release

Only GitHub Actions builds and publishes images. On every push to `main`, after all checks pass, CI
pushes the exact image it tested to:

- `ghcr.io/mrredsun/system-map:sha-<full commit sha>` (immutable; deploy this)
- `ghcr.io/mrredsun/system-map:main` (moving alias)

The image is `linux/amd64`, runs as UID 65532 on a distroless Node 22 base with no shell, and needs
no writable paths.

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
