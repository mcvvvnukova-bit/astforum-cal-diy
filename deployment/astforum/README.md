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
External calendar/video integrations require separate configuration.

## Booking email

Cal.diy sends transactional email as `АСТ Форум <notifications@astforum.ru>`
through the existing Stalwart server. Store the mailbox's hexadecimal password
as `CALDIY_SMTP_PASSWORD` in the server-only `.env`. Its original credential is
kept in `/opt/astforum-mail/secrets/notifications_password` on the VPS.

`EMAIL_SERVER` uses SMTP over TLS on port 465 and the stable Docker alias
`astforum-stalwart` on `outline_frontend`. The `tls.servername` URL parameter
sets `mail.astforum.ru` for SNI and certificate verification. Certificate
verification remains enabled. This internal route avoids the public IP's
unavailable NAT loopback from the Cal.diy container.

For `demo/60min` (event type 3), the email booking field must be required and
visible. Standard attendee emails must remain enabled. The existing manual
confirmation setting means the visitor first receives a booking-request email;
the confirmed calendar invitation follows the organizer's acceptance.

After changing SMTP settings, validate Compose and recreate only `web`, keeping
the currently deployed release's `web-command.override.yaml` in the Compose
file list. The override pins the active image and startup command; omitting it
can roll the application back. Verify SMTP authentication from the container,
an actual attendee email, and the public booking page before declaring success.

Manager acceptance sends the standard confirmation after the accepted status
has been saved, including when an external calendar/video integration fails.
An integration failure still needs the organizer's attention and does not
produce a working meeting URL. Verify this path through the authenticated
booking confirmation API, then check the received attendee calendar attachment
for `STATUS:CONFIRMED` and the expected UTC start/end times.

## Scheduled booking reminders

The optional `reminders` Compose profile runs the authenticated Tasker cron every
10 seconds. Set the same `CRON_SECRET` for web and worker and explicitly allow event
types with `BOOKING_REMINDER_EVENT_TYPE_IDS` (for example `3`). An empty allowlist
disables reminders. Existing SMTP settings are reused; no database migration is needed.

See [the reminder implementation and operating guide](../../docs/technical/booking-reminders.md)
for timing, retries, ambiguous SMTP outcomes, diagnostics, and safe activation with
the currently deployed web override. Source implementation does not imply production activation.

Production activation was verified on 2026-10-01 (Europe/Moscow) from source `8b6088261b096d94d0304512b2df4ea32d4cb8ed`, image `astforum/cal-diy:8b6088261b09`, for event type 3. Three actual worker-triggered reminders reached Gmail with SMTP 250; cancellation, rescheduling, late scheduling and duplicate suppression passed. See the [release evidence and rollback instructions](../../docs/technical/verification/2026-10-01-smtp-reminders.md).

When starting web through `yarn start` / Turbo, keep `BOOKING_REMINDER_EVENT_TYPE_IDS` in `turbo.json.globalEnv`; setting only the container environment does not pass it through Turbo's strict filtering.

## Build

Build the root Dockerfile for `linux/amd64`, using a temporary build database
and build-only secrets. Supply `VCS_REF` with the source commit and
`NEXT_PUBLIC_WEBAPP_URL=https://cal.astforum.ru`.
Never pass production database credentials as Docker build arguments.

Verify the image's `org.opencontainers.image.source`, `.revision`, and
`.licenses` labels, container health, Prisma schema compatibility, sign-in,
and the bookings and availability pages before publishing a new version.
