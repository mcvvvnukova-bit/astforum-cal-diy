# SMTP reminder deployment and delivery verification

> **For agentic workers:** Execute the operational steps inline. The source implementation and design are already approved and committed; this request explicitly authorizes GitHub publication, VPS Forum deployment and test email to the explicitly authorized Gmail recipient.

**Goal:** Publish `codex/smtp-booking-reminders`, deploy its source to VPS `forum-prod`, enable reminders for verified demo event type 3 and prove actual SMTP delivery.

**Architecture:** Build an immutable image from the current production image with the exact Git source delta. Keep the existing PostgreSQL, Redis, SMTP settings and web start command. Enable the internal reminder worker only after verification against an isolated test fixture.

**Tech Stack:** Docker Compose, Next.js, PostgreSQL, Tasker, Nodemailer, Stalwart.

## Constraints

- Requirements: https://docs.astforum.ru/doc/pub020103-pisma-s-podtverzhdeniem-i-napominaniyami-2NHmdEsUFm ; implementation `042d5184964ed58b7dfe25d68cbd520815c7190f`.
- Preserve current real booking records and all neighboring services.
- Production secrets stay on the VPS and are never printed or committed.
- Build with a disposable database, never the production database URL.
- Verify delivery at the recipient SMTP server; do not infer Gmail folder placement.
- Use separate explicitly named test bookings for the 24h, 60min and 15min triggers, plus cancellation and concurrency checks. Preserve a sanitized verification record and deactivate test fixtures afterwards.

## Task 1: Source and preflight

- [x] Read current Outline and existing implementation/operating instructions.
- [x] Verify clean source checkout on `codex/smtp-booking-reminders` and inspect differences from production `91c17f5`.
- [x] Run all 51 reminder tests, scoped TypeScript, worker syntax, Compose and Git whitespace checks.
- [x] Push the branch and verify the remote commit.

## Task 2: Immutable build and real PostgreSQL verification

- [x] Record production image, relevant event settings and release command.
- [x] Overlay the exact tracked source delta onto the pinned current image and build using a disposable PostgreSQL database.
- [x] Verify image labels, compiled cron route and production build/type check.
- [x] Exercise concurrent claims on a real PostgreSQL Task row with an isolated local SMTP receiver; assert one accepted message and one attempt.

## Task 3: Deployment and live delivery

- [x] Back up server-only environment, active Compose/override and production database.
- [x] Deploy the new source/Compose, preserve SMTP, enable verified event 3 and the internal worker using a shared generated cron secret.
- [x] Verify unauthorized cron returns 401 and authenticated POST works against the compiled production endpoint.
- [x] Create isolated accepted fixtures with future due times for all three reminder types and a cancelled fixture; let the real worker process them.
- [x] Verify persisted `smtp_accepted`, stable Message-ID and Stalwart/Gmail SMTP delivery evidence for each reminder; verify cancelled/late fixtures send nothing and a repeat cron does not duplicate messages.
- [x] Deactivate test fixtures, verify public booking/login and health, and compare neighboring container identities.
- [x] Record release/rollback instructions and evidence, commit the deployment record and push it to GitHub.

## Preflight evidence

2026-09-30: 7 test files / 51 tests passed; scoped `tsc` exited 0; worker syntax, Compose profile and `git diff --check` exited 0. Production still uses `astforum/cal-diy:91c17f5baad6`; no reminder worker is running. The source branch is clean at `bf2e301` and was absent from the GitHub remote before this request.

## Issues found before activation

- Real PostgreSQL rejected concurrent `Task.upsert` calls with `P2002`. Prisma can perform a read followed by an insert for an empty-update upsert. The fix accepts only a verified existing row with the exact reminder key/type and propagates other errors. The original real-database concurrency harness failed; the fixed harness passed 20 concurrent schedules, 30 concurrent dispatches, exactly one SMTP message/attempt, no duplicate on repeat and no message after cancellation. A permanent opt-in regression test passes against disposable PostgreSQL.
- The first production image compiled but failed its web TypeScript check because the web project targets ES5 and the allowlist used a spread over `Set`. `Array.from(new Set(ids))` retains behavior and passes the scoped check with `--target es5 --downlevelIteration false`.
- After these fixes, all 51 ordinary tests pass and the additional PostgreSQL test passes separately. Biome reports no errors/warnings (15 informational suggestions); whitespace checks pass. Targeted review covered specific duplicate handling, preservation of terminal outcomes, authenticated activation, fixture isolation, privacy and resource cleanup; no release blockers remain in the code diff. Subsequent full-build and live-delivery results are recorded below.
- The full `e62aef0` image build and web TypeScript check passed. Activation revealed Turbo's strict environment filtering: the container had `BOOKING_REMINDER_EVENT_TYPE_IDS=3`, while the actual Next.js process lacked it and therefore scheduled no tasks. An actual Turbo child-process regression first printed `reminder-env:missing`, then passed after adding the variable to `turbo.json.globalEnv`. All 52 ordinary tests and the ES5 scoped TypeScript check pass. The first six test fixtures were cancelled; no reminder tasks/messages were created for them. The corrected runtime configuration was added to the final immutable image built from the verified application image; application code is unchanged.

## Final deployment verification

Completed on 2026-10-01 Moscow time. Application source: `8b6088261b096d94d0304512b2df4ea32d4cb8ed`; active image `astforum/cal-diy:8b6088261b09`. The real worker delivered exactly three test reminders (24h, 60min, 15min) through Stalwart at 00:08:05 MSK; Gmail accepted all three with SMTP 250 at 00:08:06. Cancellation and rescheduling retired old tasks; a late confirmation produced no expired task. Repeated cron processing produced no duplicate. All twelve test bookings are cancelled, pending test reminders are skipped, the three original bookings and nineteen neighboring containers are unchanged. Web is healthy; worker runs without published ports. Public login/demo pages and adjacent sites returned HTTP 200; unauthenticated cron returned HTTP 401. Gmail folder placement is unverified.

See [the release and rollback record](../../technical/verification/2026-10-01-smtp-reminders.md) and its sanitized JSON evidence. Stalwart INFO logs do not include Message-ID: expected message IDs and delivered queue IDs are recorded separately, with correlation by the three test-recipient submissions in the acceptance window.
