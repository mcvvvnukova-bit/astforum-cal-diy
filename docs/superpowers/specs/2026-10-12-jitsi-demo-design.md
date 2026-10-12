# Jitsi for AST Forum demo bookings

Approved by the user on 2026-10-12 (Europe/Moscow).
Tasks: [PROJ-33](https://roadmap.astforum.ru/work_packages/PROJ-33), [PROJ-34](https://roadmap.astforum.ru/work_packages/PROJ-34); parent [PROJ-142](https://roadmap.astforum.ru/work_packages/PROJ-142).

## Agreed behavior

Use the existing Jitsi integration for `demo/60min` (event type 3). Configure `jitsiHost=https://vks.mvpspace.ru` and `jitsiPathPattern={uuid}`. Each manager confirmation creates a separate random room URL. The confirmation pipeline saves it in `Booking.metadata.videoCallUrl` and `BookingReference.meetingUrl` before sending the client confirmation. The booking card and reminders read this saved URL.

The event continues to require manager confirmation. Pending requests have no confirmed conference URL. Existing accepted meetings retain their original conference links. No personal information is embedded in the room name. The existing Jitsi update adapter retains a reference's URL; ordinary repeat confirmation of an accepted booking is rejected by the confirmation handler.

Jitsi starts the conference when the host connects. The portal uses internal host authentication with guest access: the host signs in and clients join as guests. This does not pre-reserve a running conference or change Jitsi authentication.

## Implementation and verification

Configure the installed Jitsi app and the demo event through the existing Cal.diy administration UI. Verify settings persist after reopening. Check two independent confirmations generate different UUID paths and that each saved URL equals its card and client confirmation/reminder URL. Verification must distinguish generated message content from SMTP acceptance and recipient delivery; real client email is outside test scope unless explicitly authorized.

Current source already implements these paths: `packages/app-store/jitsivideo/lib/VideoApiAdapter.ts`, `packages/features/bookings/lib/handleConfirmation.ts`, `apps/web/modules/bookings/components/BookingDetailsSheet.tsx`, and `packages/features/bookings/reminders/repository.ts`. No new runtime code or database schema is required. Save sanitized configuration and verification evidence; publish documentation only to the AST Forum fork.

## Limits and recovery

An external integration failure can still leave a booking accepted under the existing confirmation behavior. Validate the Jitsi configuration before activation. Capture previous app/event settings privately and restore those exact settings if verification fails. Do not rewrite historical bookings, send client emails, or create reservations while merely inspecting configuration.

GitNexus index commit matches `4bd67735895f539ad99c8037cf7a808306fb9139`, but its graph is unavailable due to a LadybugDB recovery/read-only error. Findings above are source-derived.
