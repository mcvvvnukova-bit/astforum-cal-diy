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

## Clean candidate build

From a clean checkout with Python 3.12+, Docker and Buildx:

```sh
python3 deployment/astforum/build-clean.py /absolute/empty/output --check
python3 deployment/astforum/build-clean.py /absolute/empty/output --revision "$(git rev-parse HEAD)"
```

The output must be outside the checkout and must not be a symlink or contain
existing files. `--check` validates the snapshot/output without creating files.
Only the full current HEAD is accepted. Commit all input changes first; dirty
tracked or untracked files cause rejection. The context is a Git archive of
selected application/build files, excluding historical deployment overlays.
No host dependencies, `.next`, environment files or custom images are inherited.
The existing tracked Prisma `.env` symlink and library test `.env.test` fixture
are removed from the context without reading their contents; a regular Prisma
`.env` file or any unknown private environment path causes rejection.
Yarn performs an immutable install. Prisma, app-store and embedding artifacts
are generated before the full Next build; Next type checking remains enabled
and `yarn type-check:ci --force` is a separate required build gate.

The pinned official Node 24.18.1 Bookworm image targets `linux/amd64`. Native
amd64 CI is preferred; emulation on ARM may take substantially longer. The
build needs substantial memory/disk and outbound access for dependency/font
retrieval. The whole dependency chain is not claimed byte-reproducible:
PostgreSQL 16 Alpine is digest-pinned; its actual digest and Docker/Buildx versions are recorded, while
the Node base and lockfile pin the application recipe. Independent matching
image digests require a second matching clean build.

Disposable database/auth credentials are generated privately and passed to
BuildKit through a secret mount. PostgreSQL has no published ports. After the
build, runtime verification uses a separate internal Docker network and a local
SMTP receiver. It checks actual image labels/platform and BuildKit config
identity, absence of credentials in image configuration, worker source bytes at
`/reminder-worker.mjs`, the login response, rejected and authenticated Tasker
POSTs, and the reminder suite including its real PostgreSQL reconciliation
and local SMTP MIME test. No production environment is consumed. These checks
establish candidate behavior; they do not demonstrate live server parity or
production activation, an authenticated user journey, or every booking route.

Success creates `candidate.docker.tar`, `buildkit-metadata.json` (including
BuildKit provenance), logs and `release-receipt.json`. The receipt records full
source SHA/tree, Dockerfile/lock/worker hashes, base/platform, actual image ID,
export digest, archive hash/config identity, build times and observed checks.
The archive comes directly from BuildKit and those same bytes are explicitly
loaded for runtime verification. The exported manifest and config digests are
checked against actual archive blobs. `actual_image_id` must equal the config
digest on classic stores or the exported manifest digest on containerd stores;
`image_config_id` and `archive_config_id` must always match.
The Docker exporter disables embedded attestations for compatibility. Full
`BUILDX_METADATA_PROVENANCE=max` build-record provenance is retained separately:
the pipeline requires the Git Dockerfile hash, full LLB recipe and pinned Node
material digest. The receipt includes the metadata SHA256 and explicit record
format/mode. Keep metadata, receipt and archive together. This does not claim an
embedded or signed attestation.
Failure preserves logs and `failure.json` and never emits a success receipt.
Owned temporary containers, networks, builder, secrets and image tag are removed;
cleanup failure also prevents success. Load the archive with `docker load -i`
only when needed. It is a candidate, and publication remains a separate gate.

The fork-only `AST Forum clean image` workflow invokes the same pipeline for the
exact pushed SHA and retains artifacts for seven days. It requires no DockerHub
credentials, upstream publication, production secrets or external messages.
