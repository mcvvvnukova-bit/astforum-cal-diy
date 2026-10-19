# Short Moscow Label Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax for tracking.

**Goal:** Replace the approved Russian demo timezone label with «МСК (GMT+3)» on the live widget.

**Architecture:** Change only the existing Russian translation value and corresponding consumer test expectations. Both existing consumers reuse this key; preserve their predicates and all booking behavior.

**Tech Stack:** JSON translations, React consumer tests, existing Cal.diy Docker release, Playwright smoke check.

## Global Constraints

- Exact value: `МСК (GMT+3)` for `demo_booking_moscow_time`; English and all other translations unchanged.
- No mobile behavior fix, layout, schema, dependency, event, notification, or credential changes. User's latest request is copy-only.
- Work in the existing branch as previously requested. No push, merge or PR.
- Production rollout affects web only. Retain previous image and rollback artifacts; no migrations or production database writes.
- Do not submit any booking during verification.

## Task 1: Translation and expectations

**Files:** `packages/i18n/locales/ru/common.json`, `apps/web/modules/bookings/components/DemoSlotPresentation.test.tsx`, `apps/web/modules/bookings/components/EventMeta.demo.test.tsx`.

**Interface:** The existing `demo_booking_moscow_time` key keeps the same name and has the new string value.

- [x] Check repository instructions and clean baseline. Update existing test literals from `по московскому времени (GMT+3)` to `МСК (GMT+3)` first.
- [x] Assert the desired JSON value before the translation edit; record the expected RED assertion. Change only that JSON property, then rerun the exact assertion to GREEN.
- [x] Validate JSON key/value diff against recorded BASE: only `demo_booking_moscow_time` may differ. Verify all updated test literals match the real RU resource. No imports, types, functions or assertions may otherwise change.
- [x] Run appropriate focused checks available in the runtime; report unavailable checks honestly. Commit only these three files with a conventional message. Record results in the task report.

## Task 2: Release and verification

- [x] Independently review source diff and test evidence. Owner verifies current deployed image/revision, copies the durable previous release recipe into this plan's workspace, and adapts its exact base and allowlist.
- [x] Build the exact source revision with dummy credentials/disposable database using the approved existing release workflow; copy both web build and updated i18n resource into final image. No hand-editing compiled JavaScript.
- [x] Publish web only with explicit `yarn start`, check immutable image and healthy status, preserve rollback, compare event/schema/env/config/neighbor invariants.
- [ ] Through the actual landing CTA, inspect the live first-step label and its noninteractive presentation; use a read-only guarded browser with no form submission. Check the second-step consumer via focused test/source evidence if navigating would reserve a real slot.
- [x] Record evidence and limitations, archive only owned temporary build resources recoverably. Keep existing source branch; no unrelated task completion claims.

## Publication result

- Source release: `42d0fbb05f0b7dd3596c34f90eb648d640383c7a`; image `astforum/cal-diy:42d0fbb05f0b`, immutable ID `sha256:8175a548d2dbd9e773decb574a08ae64d2ece11baaf49d685199dc6aa64f55c7`.
- Copy-only source review and final release review: no findings. Consumer tests 19/19 passed; Biome three changed files passed with project config; production compile/typecheck/build passed.
- Web healthy with `yarn start`. Actual image, revision, retained rollback image, event confirmation/provider/timezone, schema, environment, proxy/Compose and neighboring IDs/start times verified unchanged where required.
- Public booking page GET with `Accept-Language: ru` confirms the live response contains `demo_booking_moscow_time` with `МСК (GMT+3)`.
- Limitation: protected landing CTA visual check not executed. Auto-review denied reading the stored landing password; explicit permission requested and unanswered at handoff. No password read or booking submitted. Second-step label is covered by passing real consumer tests, not a live booking transition.
- No mobile predicate or unrelated behavior changed. Existing branch kept; no GitHub push, PR or merge.
- Owned temporary build directory archived recoverably under `/opt/astforum-cal-diy/releases/42d0fbb05f0b7dd3596c34f90eb648d640383c7a/build-stage`; final post-check passed again. Prior releases untouched.
