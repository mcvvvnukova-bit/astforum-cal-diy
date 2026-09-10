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

- [ ] Check repository instructions and clean baseline. Update existing test literals from `по московскому времени (GMT+3)` to `МСК (GMT+3)` first.
- [ ] Assert the desired JSON value before the translation edit; record the expected RED assertion. Change only that JSON property, then rerun the exact assertion to GREEN.
- [ ] Validate JSON key/value diff against recorded BASE: only `demo_booking_moscow_time` may differ. Verify all updated test literals match the real RU resource. No imports, types, functions or assertions may otherwise change.
- [ ] Run appropriate focused checks available in the runtime; report unavailable checks honestly. Commit only these three files with a conventional message. Record results in the task report.

## Task 2: Release and verification

- [ ] Independently review source diff and test evidence. Owner verifies current deployed image/revision, copies the durable previous release recipe into this plan's workspace, and adapts its exact base and allowlist.
- [ ] Build the exact source revision with dummy credentials/disposable database using the approved existing release workflow; copy both web build and updated i18n resource into final image. No hand-editing compiled JavaScript.
- [ ] Publish web only with explicit `yarn start`, check immutable image and healthy status, preserve rollback, compare event/schema/env/config/neighbor invariants.
- [ ] Through the actual landing CTA, inspect the live first-step label and its noninteractive presentation; use a read-only guarded browser with no form submission. Check the second-step consumer via focused test/source evidence if navigating would reserve a real slot.
- [ ] Record evidence and limitations, archive only owned temporary build resources recoverably. Keep existing source branch; no unrelated task completion claims.
