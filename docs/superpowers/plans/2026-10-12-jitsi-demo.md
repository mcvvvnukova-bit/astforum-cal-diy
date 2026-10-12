# Jitsi demo integration implementation plan

**Goal:** After manager confirmation, persist one unique `vks.mvpspace.ru` link and show it in the meeting card and client notifications.

**Architecture:** Use Cal.diy's existing Jitsi adapter and saved booking metadata. Apply app and event settings through the current administration UI; preserve the existing mail and reminder pipelines.

**Tech Stack:** Cal.diy, Jitsi Meet, PostgreSQL, existing SMTP reminders.

## Constraints

Approved design: `docs/superpowers/specs/2026-10-12-jitsi-demo-design.md`. Target event is `demo/60min`, ID 3. Keep manual confirmation enabled, use `{uuid}` without client information, preserve historical bookings, and do not send test messages to real clients. Host login and guest access remain enabled on Jitsi. Publish only to `mcvvvnukova-bit/astforum-cal-diy` with OP#PROJ-33, OP#PROJ-34 and OP#PROJ-142.

## Task 1: Configure and verify the existing integration

- [x] Verify the portal is Jitsi, the event uses Cal Video, and the existing adapter/card/email/reminder paths support the requested behavior.
- [x] Resolve real OpenProject tasks under assistant account 8 and confirm the user-approved design.
- [ ] Capture previous Jitsi app and event settings privately.
- [ ] Configure Jitsi host `https://vks.mvpspace.ru` and room pattern `{uuid}`; install the app for the demo organizer if needed.
- [ ] Set event 3 location to `integrations:jitsi`, save, and reopen to prove persistence; verify manager confirmation remains required.
- [ ] Validate distinct room paths and consistent card/notification URLs with isolated test data or captured existing test paths. Record any unavailable runtime check explicitly.
- [ ] Save sanitized evidence and operator instructions; review the exact diff, commit and push the task branch, create a draft PR, and verify the OpenProject GitHub links.

## Recovery

Restore the captured previous app/event settings if configuration verification fails. Do not modify existing meeting metadata or disable Jitsi authentication. If server access or a verification step is unavailable, preserve completed work and report that exact limitation.
