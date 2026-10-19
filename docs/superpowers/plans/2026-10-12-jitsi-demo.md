# Jitsi demo integration implementation plan

**Goal:** After manager confirmation, persist one unique `vks.mvpspace.ru` link and show it in the meeting card and client notifications.

**Architecture:** Use Cal.diy's existing Jitsi adapter and saved booking metadata. Apply app and event settings through the current administration UI; preserve the existing mail and reminder pipelines.

**Tech Stack:** Cal.diy, Jitsi Meet, PostgreSQL, existing SMTP reminders.

## Constraints

Approved design: `docs/superpowers/specs/2026-10-12-jitsi-demo-design.md`. Target event is `demo/60min`, ID 3. Keep manual confirmation enabled, use `{uuid}` without client information, preserve historical bookings, and do not send test messages to real clients. Host login and guest access remain enabled on Jitsi. Publish only to `mcvvvnukova-bit/astforum-cal-diy` with OP#PROJ-33, OP#PROJ-34 and OP#PROJ-142.

## Task 1: Configure and verify the existing integration

- [x] Verify the portal is Jitsi, the event uses Cal Video, and the existing adapter/card/email/reminder paths support the requested behavior.
- [x] Resolve real OpenProject tasks under assistant account 8 and confirm the user-approved design.
- [x] Capture previous Jitsi app and event settings privately.
- [x] Configure Jitsi host `https://vks.mvpspace.ru` and room pattern `{uuid}`; install the app for the demo organizer if needed.
- [x] Set event 3 location to `integrations:jitsi`, save, and reopen to prove persistence; verify manager confirmation remains required.
- [x] Validate distinct room paths and notification URLs with isolated test data through the live confirmation API. Card inspection exposed the display bug described below.
- [x] Save sanitized evidence and operator instructions; review the exact diff, commit and push the task branch, create a draft PR, and verify the OpenProject GitHub links (PR 5, tasks 70/71/180).

## Task 2: Preserve the generated URL in the meeting card

- [x] Reproduce the live card showing the generic Jitsi hint despite a saved URL.
- [x] Extract the existing response-location decision into `apps/web/modules/bookings/lib/getRescheduleLocation.ts`; observe the regression fail against its previous behavior.
- [x] Suppress a rescheduling override when its provider equals the persisted booking location. Keep different-provider previews and handle absent/invalid responses.
- [x] Run the new regression and confirmation tests (14 passing) and the reminder suite (52 passing, one opt-in PostgreSQL test skipped).
- [x] Complete web TypeScript verification. Full `type-check:ci --force` passes (9/9) after aligning the branch with the deployed `711aacc` base. Baseline Biome diagnostics are recorded.
- [x] Build and publish after explicit user authorization. Clean build run 38298793041 passed; web image `astforum/cal-diy:aefeda9b17b1` is healthy. Reopen both confirmed cards and verify each actual link matches its saved URL. Preserve the other 19 containers, database schema, environment, Jitsi settings and real bookings.
- [x] Cancel all three isolated verification bookings without invoking mail transport; prove zero active fixtures/reminder tasks and unchanged real bookings. The clean build also ran all 53 reminder tests with PostgreSQL and isolated SMTP, with no skips.

## Recovery

Restore the captured previous app/event settings if configuration verification fails. Do not modify existing meeting metadata or disable Jitsi authentication. If server access or a verification step is unavailable, preserve completed work and report that exact limitation.
