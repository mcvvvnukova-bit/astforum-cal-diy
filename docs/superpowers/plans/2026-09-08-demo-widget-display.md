# Demo Widget Display Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for Task 1 and its reviews. The owner performs isolated runtime setup, production build and publication in Task 2. The user approved the written specification and explicitly retains manual confirmation.

**Goal:** In the embedded demo/60min booking flow, force 24-hour time and omit the format switch, confirmation information row and location information row.

**Architecture:** Add one scoped presentation hook based on existing embed and booker context. Use it in the time-format consumer and the two display components. Keep stored preferences and event data untouched; rebuild the pinned self-hosted application.

**Tech Stack:** Cal.diy React/Next.js, Zustand, Vitest/Testing Library, Node 20, Docker, existing AST Forum VPS.

**Spec:** `docs/superpowers/specs/2026-09-08-demo-widget-display-design.md` (approved).

## Global Constraints

- Target only embedded `demo/60min` on `cal.astforum.ru`, currently opened from `dev.astforum.ru` with namespace `60min`.
- Always render times as `HH:mm`, even if `timeOption.is24hClock` is `false`; do not render the time-format toggle in the target flow.
- Do not render the event-details confirmation and location rows in the target flow. Preserve description, duration, timezone, calendar, slots and form.
- Preserve manual confirmation (`requiresConfirmation`) and meeting locations/providers. Keep pending-confirmation status after submission truthful.
- No database migrations or writes, SMTP changes, new dependencies, Cal.diy reinstallation, unrelated refactoring, other-event changes or other-service restarts.
- Preserve non-target presentation and the visitor's saved global time preferences. Use existing React/UI primitives and no CSS iframe injection.
- Do not create a real booking or send mail during verification.

## Task 1: Scoped presentation behavior and tests

**Files:**
- Create: `packages/features/bookings/Booker/hooks/useDemoWidgetPresentation.ts` (small scoped predicate/hook; name may be narrowed consistently).
- Modify: `packages/features/bookings/Booker/hooks/useBookerTime.ts`.
- Modify: `packages/features/bookings/components/TimeFormatToggle.tsx`.
- Modify: `apps/web/modules/bookings/components/event-meta/Details.tsx`.
- Create focused tests alongside the hook/components, at most three test files. Keep total task source diff small.

**Interface:** The presentation hook exposes whether the current flow is the embedded username `demo`, event slug `60min`; all three consumers must use the same decision. Use `useIsEmbed` plus booker state and verify the toggle's call sites have the needed context. Do not use or modify the numeric event ID to change business settings. The effective time format is derived in `useBookerTime`, not applied to the global preference store.

- [ ] Read the scoped current components and applicable AGENTS/TDD/React rules. No new brainstorming gate: approved spec is binding.
- [ ] Add tests first that exercise actual hook/rendered component behavior. Test target embed with 12-hour saved preference, non-embedded same event, and another embedded event. Render the time toggle and EventDetails with real UI components; mock only the embed/external boundaries needed by tests.

```tsx
// With target embed/booker context and original time preference h:mma:
expect(result.current.timeFormat).toBe("HH:mm");
expect(timePreferencesStore.getState().timeFormat).toBe("h:mma");
// Render EventDetails using an event whose requiresConfirmation is true and
// location is integrations:daily. Target omits those rows, duration remains;
// non-target still renders both. Freeze the event fixture to catch mutation.
```

- [ ] Run tests with the owner's `.superpowers/sdd/2026-09-08-demo-widget-display/run-checks.sh tests <test paths>` against an isolated copy of the pinned deployed image. Tests must fail for the missing behavior before implementation. The helper is being prepared by the owner; coordinate when test files are ready if it is not yet present.
- [ ] Add the scoped hook and integrate it. Return `TimeFormat.TWENTY_FOUR_HOUR` from the target time consumer; return `null` from the target toggle after its hooks; skip only `EventDetailBlocks.REQUIRES_CONFIRMATION` and `EventDetailBlocks.LOCATION` for the target details. Do not mutate event input or global stores.
- [ ] Run focused tests to GREEN. Run related existing booker/time tests where feasible. Run `biome` checks on changed files and TypeScript check through the isolated helper; distinguish genuine new errors from baseline evidence. Report limitations rather than modifying unrelated code.
- [ ] Self-review and commit only task source/tests with conventional commit. Write RED/GREEN commands/results, file list, implementation explanation and concerns to the task report. No SSH beyond the provided isolated-check helper; no deployment, full image build, pushes, data writes or subagents.

## Task 2: Owner build, browser verification and publication

**Inputs:** Reviewed Task 1 commit and current immutable production image `astforum/cal-diy:1cc628cb98e5`.
**Files:** Scoped build/test helpers and task ledger under this plan's ignored workspace; source archive and temporary isolated build services on VPS.

- [ ] Record current image ID, event-3 confirmation/location settings using read-only checks, Compose/secret hashes, service health and current public widget behavior.
- [ ] Run Task 1 checks in an ephemeral network-isolated container using installed dependencies from the existing image. Do not run tests inside the production container or supply production credentials.
- [ ] Generate task-review and final-review packages. Resolve blocking findings through the implementer; keep parent browser/build work independent.
- [ ] Create a scoped temporary source archive from the exact reviewed commit and build a new pinned image using Docker's existing cache. Use disposable build-only PostgreSQL and secrets if the build requires a database, never production DB credentials. Preserve existing deployment and rollback image.
- [ ] Verify the new image before cutover where possible. Publish by changing only the Cal.diy web image reference and recreating only that web service with `--no-deps`; do not restart database/Redis or other applications. Capture old image/configuration for rollback.
- [ ] Check authenticated dev popup at desktop and mobile sizes, setting saved browser time format to 12-hour first. Verify 24-hour slots/form, absent toggle and two rows, duration/timezone retained, close/reopen, unchanged direct booking page, no browser errors and no booking submitted.
- [ ] Re-read event settings to prove manual confirmation/location data unchanged. Check neighboring services and record public result and rollback details. Remove only owned disposable test/build resources; keep rollback material.
