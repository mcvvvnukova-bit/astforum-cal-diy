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
- [ ] Review the diff and commit only the repair, tests and this plan on `codex/fix-booking-confirmation-email`.

## Deployment and verification

- [x] Build a new immutable image from active `astforum/cal-diy:b40981cbcf6a` with only the changed source overlay and a disposable build database.
- [ ] Preserve active Compose files, SMTP settings, image and neighboring container identities; publish only the new web image with the existing start command.
- [ ] Exercise a manager confirmation against an isolated test booking using the real confirmation handler and SMTP, with the test service mailbox as recipient. Verify persisted accepted status and received confirmation message.
- [ ] Recover the missing notification for accepted booking 2, without reconfirming or duplicating calendar records; inspect the SMTP delivery result.
- [ ] Verify public HTTPS, container health and unchanged neighboring services, then document evidence and the remaining unconfigured Daily integration.

## Evidence before deployment

- Root cause: at 2026-09-10 23:39:45 UTC the manager accepted booking 2, while Daily returned `Location app daily-video is either disabled or not seeded at all`. The integration failure branch omitted the attendee confirmation email even though the booking became accepted. SMTP delivery of the preceding booking request had succeeded.
- Regression before repair: four failed assertions, three passing cases. After repair: seven confirmation cases and sixteen existing email-manager cases passed.
- Production Next.js build compiled successfully and completed TypeScript checking; no dependency, database schema or integration configuration changes.
- Reviewed persistence ordering, successful integration metadata, recurring acceptance, notification opt-outs and the unavailable video URL. The existing Daily integration remains unconfigured; the repair confirms acceptance without inventing a meeting link.
- Build used a disposable database and build-only secrets; runtime SMTP credentials were not passed into the build.
