# Booking confirmation email repair

**Goal:** A booking accepted by its manager sends its standard confirmation email even when an optional calendar/video integration returns a failure.

**Architecture:** Keep the existing acceptance decision and integration diagnostics. Send the existing confirmation templates after the accepted status has been persisted, outside the integration-success branch. Preserve email opt-outs, recurrence and successful meeting metadata.

**Tech Stack:** Cal.diy, TypeScript, Vitest, PostgreSQL, Docker, Stalwart.

## Constraints

- Change only `packages/features/bookings/lib/handleConfirmation.ts` and its regression test.
- No dependency/schema changes or video-service configuration changes.
- Preserve server-only SMTP configuration and the currently active release.
- Do not change an existing real booking's status to retest it.
- Use an isolated test booking and local service mailbox for the actual confirmation flow; recover the missed attendee notification separately once delivery is verified.

## Repair and regression verification

- [x] Add `handleConfirmation.test.ts`, executing the real handler with external calendar/video, database and email transport boundaries replaced by controlled doubles.
- [x] Run the regression against the current implementation: accepting a booking with a failed Daily result must call the confirmation email boundary, after the database update. Expect the missing email assertion to fail.
- [x] Move the existing `sendScheduledEmailsAndSMS` block after the booking update branch; retain integration diagnostics and metadata handling.
- [x] Verify failures, successful metadata, no integrations, global opt-out, individual preferences, database failure and recurring acceptance.
- [x] Run the focused regression and email-manager tests, Biome on the two changed source files and the production build's TypeScript check.
- [x] Review the diff and commit only the repair, tests and this plan on `codex/fix-booking-confirmation-email`.

## Deployment and verification

- [x] Build a new immutable image from active `astforum/cal-diy:b40981cbcf6a` with only the changed source overlay and a disposable build database.
- [x] Preserve active Compose files, SMTP settings, image and neighboring container identities; publish only the new web image with the existing start command.
- [x] Exercise a manager confirmation against an isolated test booking using the real confirmation handler and SMTP, with the test service mailbox as recipient. Verify persisted accepted status and received confirmation message.
- [x] Recover the missing notification for accepted booking 2, without reconfirming or duplicating calendar records; inspect the SMTP delivery result.
- [x] Verify public HTTPS, container health and unchanged neighboring services, then document evidence and the remaining unconfigured Daily integration.

## Evidence before deployment

- Root cause: at 2026-09-10 23:39:45 UTC the manager accepted booking 2, while Daily returned `Location app daily-video is either disabled or not seeded at all`. The integration failure branch omitted the attendee confirmation email even though the booking became accepted. SMTP delivery of the preceding booking request had succeeded.
- Regression before repair: four failed assertions, three passing cases. After repair: seven confirmation cases and sixteen existing email-manager cases passed.
- Production Next.js build compiled successfully and completed TypeScript checking; no dependency, database schema or integration configuration changes.
- Reviewed persistence ordering, successful integration metadata, recurring acceptance, notification opt-outs and the unavailable video URL. The existing Daily integration remains unconfigured; the repair confirms acceptance without inventing a meeting link.
- Build used a disposable database and build-only secrets; runtime SMTP credentials were not passed into the build.

## Deployed verification

- Repair commit: `91c17f5baad61d7f729a37dc437f00eb54628401`. Active image: `astforum/cal-diy:91c17f5baad6`, digest `sha256:5ddaf76713b3a82054f63529f6c4319b6ced8c57bef54c92c53fd45ef4841137`.
- Production build and TypeScript check passed. The final candidate passed all 23 tests again. Biome reported no errors and one pre-existing unused-variable warning for `acceptedBookings`.
- Backup: `/opt/astforum-cal-diy/backups/confirmation-email-20260911T000310Z/`. The release override is under `/opt/astforum-cal-diy/releases/91c17f5baad61d7f729a37dc437f00eb54628401/`.
- At 00:04 UTC on 2026-09-11 the authenticated, compiled `/api/trpc/bookings/confirm` endpoint returned HTTP 200 and `ACCEPTED` for an isolated fixture. Daily failed with the original error; the attendee confirmation nevertheless arrived through SMTP and was verified through IMAPS, including `STATUS:CONFIRMED` and the correct UTC calendar time. Message ID: `86c67d92-44cf-d4cf-c8ab-67ddb3058f24@astforum.ru`.
- The fixture booking, event type and user were deleted after verification. No existing booking was reconfirmed.
- Booking 2's missed attendee confirmation was rendered from the actual accepted booking and sent once. Its calendar specifies 2026-09-17 10:00–11:00 UTC (13:00–14:00 Europe/Moscow). Gmail accepted it at 00:05:06 UTC with SMTP 250. Queue ID: `328844141179968512`; message ID: `be5e807a-3fa5-36e7-c969-4d467a04a1aa@astforum.ru`. This verifies recipient-server acceptance, not placement in the inbox.
- Both the development landing page and Cal.diy login returned HTTPS 200. The web container is healthy; SMTP configuration and all twelve neighboring container IDs/start times were preserved.
