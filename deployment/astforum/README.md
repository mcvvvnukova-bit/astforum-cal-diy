# AST Forum deployment

This fork runs the MIT-licensed Cal.diy code at `https://cal.astforum.ru`.
Upstream: `https://github.com/calcom/cal.diy`; initial base commit:
`e91bb0c38251b0ee6f87eec70ce4940822fb0cf3`.

## Runtime

Use `compose.yaml` with a server-only `.env` based on `env.example`.
Keep credentials outside the Git checkout and set file permissions to `0600`.
Set `CALDIY_IMAGE` to the exact image tag built from the fork commit.

```sh
docker compose --env-file /opt/astforum-cal-diy/.env \
  -f deployment/astforum/compose.yaml config -q
docker compose --env-file /opt/astforum-cal-diy/.env \
  -f deployment/astforum/compose.yaml up -d
```

PostgreSQL and Redis have dedicated internal volumes and no published ports.
Only the web service joins the existing `outline_frontend` proxy network.
Configure Caddy's `cal.astforum.ru` route to proxy to
`astforum-cal-diy-web-1:3000` and forward the external HTTPS scheme.

The entrypoint applies this fork's migrations before starting the application.
It stops on migration or app-store seeding errors.
Do not import a complete Cal.com database or use the `calcom/cal.com` image.

Initialize the first administrator through `/api/auth/setup` before exposing
the new instance publicly. Public signup is disabled; first setup is allowed
only while the user table is empty. Generate new credentials for a clean install.
SMTP and external calendar/video integrations require separate configuration.

## Build

Build the root Dockerfile for `linux/amd64`, using a temporary build database
and build-only secrets. Supply `VCS_REF` with the source commit and
`NEXT_PUBLIC_WEBAPP_URL=https://cal.astforum.ru`.
Never pass production database credentials as Docker build arguments.

Verify the image's `org.opencontainers.image.source`, `.revision`, and
`.licenses` labels, container health, Prisma schema compatibility, sign-in,
and the bookings and availability pages before publishing a new version.
