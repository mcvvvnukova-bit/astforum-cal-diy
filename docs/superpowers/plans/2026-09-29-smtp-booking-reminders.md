# SMTP booking reminders implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The user chose Cal.diy → existing SMTP and authorized publication of the technical section in PUB.02.01.03.

**Goal:** Add durable, cancellation-aware demo reminders at 24 hours, 60 minutes and 15 minutes using Cal.diy Tasker and the existing SMTP transport.

**Architecture:** A reconciler schedules reminders from persisted accepted bookings. Tasker dispatches a reminder handler which owns its durable task lifecycle, atomically claims each send, reloads the booking, and records SMTP acceptance, skip, permanent failure or an ambiguous outcome. The existing Task table stores a versioned payload and a stable unique reference; no new schema or dependencies are required.

**Tech Stack:** TypeScript, Prisma/PostgreSQL, Tasker, Nodemailer, Vitest.

## Global constraints

- Source requirement: https://docs.astforum.ru/doc/pub020103-pisma-s-podtverzhdeniem-i-napominaniyami-2NHmdEsUFm . Read live on 2026-09-29; the technical section is empty.
- Only explicitly configured event type IDs receive reminders. Deployment example enables event 3; an unset allowlist disables the module.
- Only ACCEPTED, non-rescheduled bookings qualify. A 24-hour reminder additionally requires at least 48 hours from creation of the current booking to start.
- Schedule only future reminders; a scheduled reminder has a 60-second processing window. Older jobs are skipped, including after outages. UTC storage, Europe/Moscow and 24-hour display.
- The saved booking UID plus start/end identifies the schedule version; native reschedules create a new booking UID. Recheck immediately before SMTP.
- One primary booking email per reminder; no bulk campaigns or guest fan-out. No live test messages without an explicit recipient request.
- SMTP acceptance is not delivery. A transport result with no confirmed accepted recipient is not success. Unknown outcomes and interrupted sends are quarantined; no blind automatic resend.
- Retain terminal Task records for deduplication and diagnosis. Never print task payloads containing addresses or meeting URLs.
- Existing confirmation/decline/cancellation emails and their UI are outside this reminder module. No production activation claimed without deployment verification.
- Preserve all existing Outline content, including collapsed email previews; edit only the requested technical section and verify after reload.

## Task 1: Reminder policy and content

**Files:** `packages/features/bookings/reminders/policy.ts`, `message.ts`, `policy.test.ts`, `message.test.ts`.
**Interfaces:** `planReminders(booking, now): ReminderPayload[]`; `isCurrentReminder(payload, booking, now): boolean`; `buildReminderMessage(booking, payload, origin, from): SMTP message`.

- [x] Add failing table tests: pending/cancelled/rejected; 48-hour boundary; confirmation after 60/15-minute deadline; Moscow date rollover; escaping user text; unsafe conference URLs.
- [x] Verify tests fail against the missing policy, then implement pure policy and message functions.
- [x] Literal example: meeting `2026-10-02T12:00:00Z`, creation `2026-09-30T12:00:00Z`, reconciliation `2026-09-30T13:00:00Z` yields `2026-10-01T12:00:00Z`, `2026-10-02T11:00:00Z`, `2026-10-02T11:45:00Z`.
- [x] Run the policy/content suite. Include the verified files in the coherent implementation commit after integration.

## Task 2: Durable scheduling and delivery

**Files:** `packages/features/bookings/reminders/service.ts`, `repository.ts`, `smtp.ts`, `service.test.ts`, `smtp.test.ts`.
**Interfaces:** Reconciler upserts future payloads using Tasker's unique reference; delivery receives a Task ID, claims by compare-and-swap, reloads booking and returns a durable outcome. SMTP adapter exposes accepted recipient information and errors without swallowing them.

- [x] Write failing behavioral tests for duplicate reconciliation, concurrent workers, cancelled/moved bookings after scheduling, late tasks, SMTP 4xx retry limit, 5xx permanent failure, DATA timeout quarantine, process interruption, and SMTP acceptance followed by persistence failure.
- [x] Implement lifecycle ownership with durable `queued`, `sending`, `smtp_accepted`, `skipped`, `failed`, `unknown` states. Claim persisted before SMTP; use stable Message-ID for investigation, not as a guarantee of SMTP deduplication.
- [x] Retry only explicit transient refusals or failures known to happen before message submission, at most three attempts and within the original deadline. Retain unknown outcomes for operator reconciliation.
- [x] Implement Prisma adapter with selected booking fields, bounded pagination, upsert, and atomic conditional updates. Keep personal data out of logs/errors.
- [x] Test real Nodemailer against a local-only SMTP fixture. Include the module in the coherent implementation commit after integration.

## Task 3: Tasker integration and operational entry point

**Files:** `packages/features/tasker/tasker.ts`, `tasks/index.ts`, `task-processor.ts`, `api/cron.ts`, reminder configuration and deployment documentation.
**Interfaces:** Register `sendBookingReminder`; its handler owns success/retry accounting so duplicate Tasker dispatch does not mark another worker's send successful. Authenticated cron reconciles before processing.

- [x] Add failing tests for managed lifecycle dispatch, cron authorization with missing/incorrect secret, disabled allowlist, configuration validation and preservation of ordinary Tasker behavior.
- [x] Register and call the module. Fail closed when CRON_SECRET is absent. Add a documented protected cron invocation and opt-in environment settings.
- [x] Run targeted regression suite, applicable type checks and Biome; preserve unrelated baseline failures in the verification report.
- [x] Commit implementation and runtime instructions.

## Task 4: Review and publish technical documentation

**Files:** `docs/technical/booking-reminders.md`; verification evidence under this plan's scratch directory; requested Outline section.

- [x] Fresh-context whole-change review: concurrency, post-SMTP crashes, late confirmation, cancellation races, opt-in boundaries, recipient privacy and observability.
- [x] Fix actionable findings with a failing regression test followed by a passing test.
- [x] Write exact settings, states, timing tolerance, retries, limitations, code revision and test results. Distinguish implemented source from production activation.
- [x] Insert only the technical section in Outline; reload, compare the surrounding content and inspect rendered state.

## Review focus

SMTP and database commits are not atomic: verify no automatic duplicate after an ambiguous result, and do not claim exactly-once delivery. Cancellation can race after the final state read; state the boundary honestly. Ensure daily reconciliation does not resurrect terminal tasks or accidentally enable emails for other events.

## Verification result

51 targeted tests pass, including local SMTP and schema-backed Prismock tests. Scoped production TypeScript, worker syntax, Compose configuration and whitespace checks pass. The final reviewer reports no remaining important findings. Full image build, real PostgreSQL concurrency and production delivery are not yet verified.

Published to the requested Outline section on 2026-09-30. After reload, the full editor text matched exactly (16,913 characters); the original prefix, seven template groups, seven technical subsections and three tables were preserved. Shell commands were published as separate single-line paragraphs to avoid rich-paste newline loss. Implementation commit: `042d518`.
