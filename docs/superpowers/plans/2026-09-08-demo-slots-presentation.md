# Demo Slots Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the approved full-date heading and relocated non-interactive timezone on the first step of the embedded demo widget.

**Architecture:** Gate presentation at existing booking-owned components with one shared first-step predicate. Format a selected calendar date without shifting it through an instant's timezone, render the timezone after the slots inside their scroll flow, and remove both desktop and mobile legacy selectors only in the target scope. Keep backend data and the published second step unchanged.

**Tech Stack:** Cal.diy, React/Next.js, existing Booker store/hooks and native UI components, Intl.DateTimeFormat, Vitest/Testing Library, Playwright, Docker.

**Spec:** `docs/superpowers/specs/2026-09-08-demo-slots-presentation-design.md`, approved.

## Global Constraints

- Target: first step of embedded `demo/60min` on `cal.astforum.ru`, opened from `dev.astforum.ru`, `month_view` and its mobile variant only. Preserve second step, direct non-embedded page, other events and other layouts.
- Exact Russian example: «вторник, 8 сентября 2026 г.». Use selected date, full weekday/month/year, numeric day without a leading zero. Update on day/month/year changes; allow text wrapping without truncation.
- Remove left timezone block. Under slots/empty-state in the same content flow show «по московскому времени (GMT+3)» only for actual `Europe/Moscow`; otherwise show the real timezone. Preserve globe icon. No dropdown, arrow, disabled/lock tooltip, `not-allowed` cursor, tab stop, or timezone writes.
- Preserve manual confirmation, 24-hour format, hidden confirmation/Cal Video blocks and all second-step changes. No dependency, schema, credential, event-setting or backend changes; reuse `demo_booking_moscow_time` and `all_booked_today` translations.
- No iframe DOM/CSS injection, unrelated refactors or general form behavior changes. Limit source work to the web package, aiming below 500 changed code lines and 10 code files; report a concrete conflict instead of dropping tests.
- Production build uses dummy secrets and a disposable DB. Rollout/rollback recreate web only, with explicit `yarn start`, no migrations/seed, no neighboring restarts.
- Verification must not submit a booking or send mail. Any transition that reserves a slot must use dry-run, validating every single/batch envelope and rejecting SuperJSON metadata.

## Task 1: First-step presentation and focused regression tests

**Files:**
- Create `apps/web/modules/bookings/hooks/useDemoSlotSelectionPresentation.ts`: the single target predicate.
- Create `apps/web/modules/bookings/lib/formatSlotSelectionDate.ts`: pure selected-calendar-date formatting shared by both headers.
- Modify `apps/web/modules/bookings/components/AvailableTimesHeader.tsx`: full-date target heading, original fallback unchanged.
- Modify `apps/web/modules/bookings/components/AvailableTimeSlots.tsx`: timezone footer after slots/target empty-state inside each day container.
- Modify `apps/web/modules/bookings/components/EventMeta.tsx`: omit old timezone block only on target first step.
- Modify `apps/web/modules/bookings/components/SlotSelectionModalHeader.tsx`: target full date and no duplicate mobile selector; preserve back action/duration/default path.
- Create `apps/web/modules/bookings/components/DemoSlotPresentation.test.tsx`: real header/slots/mobile-header behavior.
- Modify `apps/web/modules/bookings/components/EventMeta.demo.test.tsx`: replace obsolete target first-step expectation, retain second-step tests and add non-target first-step controls.

**Interfaces:**
- Consume `useDemoWidgetPresentation(): boolean`, `useBookerStoreContext`, `BookerLayouts`, `useBookerTime(): { timezone: string; ... }`, `useLocale()` and existing `Dayjs` date props.
- Produce `useDemoSlotSelectionPresentation(): boolean` and `formatSlotSelectionDate(date: Dayjs, language: string): string` with direct imports.
- Test IDs for target consumers: `demo-slot-date`, `demo-slot-timezone`, `demo-slot-empty`. Existing `event-meta-current-timezone` identifies the removed legacy selector.

- [ ] Read repository AGENTS, TDD and React guidance; inspect these components and their props. Do not read a different plan's ignored workspace. Owner supplies the isolated check helper from the pinned current image.
- [ ] Add consumer tests before implementation. Use existing `@calcom/features/bookings/Booker/__tests__/test-utils` render wrapper; mock only external embed/locale/timezone-query boundaries. Use actual RU resources, actual `AvailableTimesHeader`, `AvailableTimeSlots` and `SlotSelectionModalHeader`, not mocked JSX substitutes.

Core fixture and assertions (test-only schedule is intentionally a partial query-response boundary):

```tsx
const targetStore = {
  username: "demo", eventSlug: "60min", state: "selecting_time" as const,
  layout: BookerLayouts.MONTH_VIEW, selectedDate: "2026-09-08", timezone: "Europe/Moscow",
};
const renderSlots = (slots: Slot[], store: Partial<BookerStore> = {}) => {
  const schedule = {
    data: { slots: { "2026-09-08": slots } }, invalidate: vi.fn(),
  } as unknown as useScheduleForEventReturnType;
  return render(
    <AvailableTimeSlots schedule={schedule} isLoading={false} limitHeight event={{ data: null }}
      loadingStates={{ creatingBooking: false, creatingRecurringBooking: false }}
      isVerificationCodeSending={false} renderConfirmNotVerifyEmailButtonCond={false}
      onSubmit={vi.fn()} skipConfirmStep={false} unavailableTimeSlots={[]}
      onAvailableTimeSlotSelect={vi.fn()} />,
    { mockStore: { ...targetStore, ...store } }
  );
};

const { rerender } = render(<AvailableTimesHeader date={dayjs("2026-09-08")} />,
  { mockStore: targetStore });
expect(screen.getByText("вторник, 8 сентября 2026 г.")).toBeVisible();
rerender(<AvailableTimesHeader date={dayjs("2027-01-01")} />);
expect(screen.getByText("пятница, 1 января 2027 г.")).toBeVisible();
// In a separate case, pass dayjs.tz("2026-09-08 00:00", "Pacific/Kiritimati"):
// the visible date must remain September 8, not the previous UTC day.

renderSlots([{ time: "2026-09-08T11:00:00.000Z" } as Slot]);
const time = await screen.findByTestId("time");
const zone = screen.getByTestId("demo-slot-timezone");
expect(time).toHaveTextContent("14:00");
expect(zone).toHaveTextContent("по московскому времени (GMT+3)");
expect(time.compareDocumentPosition(zone) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
expect(zone.querySelector("button,input,select,[role=combobox],[tabindex]")).toBeNull();
expect(zone.className).not.toContain("cursor-not-allowed");

// Separate test with renderSlots([]):
const empty = await screen.findByTestId("demo-slot-empty");
expect(empty).toHaveTextContent("Все интервалы забронированы.");
expect(empty.compareDocumentPosition(screen.getByTestId("demo-slot-timezone"))
  & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
```

- [ ] Add the control matrix: non-embed same event, another embedded event, week/column layouts and `booking` state must not get this first-step presentation. Preserve existing second-step Moscow/non-Moscow tests. New target EventMeta test requires no `event-meta-current-timezone`; non-target tests retain selector and old order. For mobile header, assert full date, no combobox/globe selector above slots, and retained back callback. Assert non-Moscow footer is literal `Asia/Yekaterinburg`, not Moscow copy. Also verify the footer when `hideAvailableTimesHeader` is true (mobile dialog).
- [ ] Run only the two focused test files to RED through the owner helper. Confirm target failures are missing full-date/footer or still-present selector, not broken fixtures. Baseline controls must pass. No fake clocks are required: pass explicit calendar dates.
- [ ] Implement the common predicate and date formatter:

```tsx
export const useDemoSlotSelectionPresentation = (): boolean => {
  const isDemoWidget = useDemoWidgetPresentation();
  const state = useBookerStoreContext((value) => value.state);
  const layout = useBookerStoreContext((value) => value.layout);
  return isDemoWidget && layout === BookerLayouts.MONTH_VIEW
    && (state === "selecting_date" || state === "selecting_time");
};

export const formatSlotSelectionDate = (date: Dayjs, language: string): string => {
  if (!date.isValid()) return "";
  const calendarDate = new Date(Date.UTC(date.year(), date.month(), date.date()));
  return new Intl.DateTimeFormat(language, {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  }).format(calendarDate);
};
```

UTC here only hosts the chosen calendar components; do not convert `date.toDate()` into UTC and thereby change its calendar day. Existing locale values are the formatter's locale source.

- [ ] In `AvailableTimesHeader`, render `formatSlotSelectionDate(date, i18n.language)` in a wrapping `demo-slot-date` span under the target predicate; keep existing abbreviated spans otherwise. Preserve current header weight/custom class hooks and TimeFormatToggle behavior. In `SlotSelectionModalHeader`, use the same formatter for the selected date, suppress its second legacy date line and timezone row only for target, and retain the back button and duration.
- [ ] In `EventMeta`, assign `const isDemoSlotSelection = useDemoSlotSelectionPresentation()` and render the existing entire timezone `EventMetaBlock` only when `!isDemoSlotSelection`; do not move or alter the second-step block/order. Its old hover/disabled styling then cannot appear on target first step.
- [ ] Add target footer inside the existing per-day scroll container, immediately after the slot content, not outside the grow/400px scroll region. Use native globe icon and a non-focusable text container:

```tsx
<div data-testid="demo-slot-timezone" className="mt-2 flex cursor-default items-start gap-2 pb-4 text-sm text-default">
  <GlobeIcon aria-hidden="true" className="h-4 w-4 shrink-0" />
  <span>{timezone === "Europe/Moscow" ? t("demo_booking_moscow_time") : timezone}</span>
</div>
```

Use `useBookerTime()` so labels and slots share the same effective zone; never call timezone setters. Render the footer on target even when the visible day has no slots, and after any out-of-office content.

- [ ] Handle the target empty array locally: current `AvailableTimes` has an all-OOO shortcut where `[].every(...)` is true, so relying on its empty message loses that message. In `AvailableTimeSlots`, only for target and `slots.slots.length === 0`, render a native empty container with `data-testid="demo-slot-empty"` and `t("all_booked_today")`; otherwise keep the existing `AvailableTimes` call. Do not change the shared OOO algorithm or unrelated empty-state behavior.
- [ ] Run focused tests to GREEN, then current booking-form, phone-mask, form-builder, EventDetails, time-hook and time-toggle regressions. Run Biome on changed files, full web typecheck in isolated runtime, and `git diff --check`. Compare baseline warnings without silently claiming pristine output. Commit only intended source/tests after checks; report exact RED/GREEN commands, counts, files and any line-budget conflict. No production build/deploy/push by source implementer.

## Task 2: Independent verification, build and web-only publication

**Inputs:** Reviewed source commit from Task 1; expected current image `astforum/cal-diy:c1f8e3e00ad5`, ID `sha256:09581c294d9b3ad5f079a63f4a6982adfa38d623397a0356db3dd56928fd3c98` (verify, never assume). Source baseline before Task 1 must be recorded.

**Files:** This plan's own ignored workspace for helpers/evidence. Published prior recipe available under `/opt/astforum-cal-diy/releases/c1f8e3e00ad57994bd41efde1b8231e4437c84b6`; no need to read previous plans' ignored local directories. New durable release directory keyed by the new exact source SHA.

- [ ] Preflight read-only: verify image/CMD/health, event 3 manual confirmation/timezone lock/provider, schema hash, env hash excluding image, neighboring identities and Compose/proxy hashes. Provide a network-none disposable pinned-image test/typecheck helper that overlays only this task's source/tests plus Vitest config/mocks, no `.env`.
- [ ] Review Task 1 with spec+quality gates; resolve findings through implementer. Perform final current-change/release review. Preserve exact source SHA and a clean tracked application tree; do not use `HEAD~1` as a multi-commit review base.
- [ ] Adapt the durable prior release recipe to the verified current base and new SHA. Build in a separate systemd unit, with temporary DB and dummy credentials, unchanged dependencies, exact allowlisted git archive, and an explicit exit log. Inspect built revision label and `CMD ["yarn", "start"]` before publication.

```dockerfile
FROM astforum/cal-diy:c1f8e3e00ad5 AS builder
WORKDIR /calcom
COPY overlay/ ./
ARG BUILD_DATABASE_URL
RUN DATABASE_URL="$BUILD_DATABASE_URL" DATABASE_DIRECT_URL="$BUILD_DATABASE_URL" \
    NEXTAUTH_SECRET=disposable-build-only \
    CALENDSO_ENCRYPTION_KEY=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    NEXTAUTH_URL=https://cal.astforum.ru/api/auth NEXT_PUBLIC_WEBAPP_URL=https://cal.astforum.ru \
    CALCOM_TELEMETRY_DISABLED=1 NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1 \
    BUILD_STANDALONE=true NODE_OPTIONS=--max-old-space-size=4096 yarn workspace @calcom/web build
FROM astforum/cal-diy:c1f8e3e00ad5
COPY --from=builder /calcom/apps/web /calcom/apps/web
ARG VCS_REF
LABEL org.opencontainers.image.revision=$VCS_REF
CMD ["yarn", "start"]
```

- [ ] Preserve prior image/env/changed source and verified rollback. Update only `CALDIY_IMAGE` and task source files; recreate only web. Both compose paths must use an override with `services.web.command: ["yarn", "start"]`. Require actual expected image plus healthy status before forward/rollback success. No migrations, database resets or neighboring service restarts.
- [ ] Run desktop/mobile browser checks through the real CTA. Assert full date for selected day, change day and next month, check wrapping/bounds and timezone position after final slot. Hover/focus the label: ordinary cursor, no list/lock tooltip or tab stop. Check no left selector and the mobile slot-selection variant. Confirm no first-step date/footer changes on direct page or other layouts, and preserve second-step phone/agreement/order.
- [ ] Test empty-state placement in component tests and with a read-only mocked schedule response if needed for visual coverage; never edit real availability to manufacture an empty day. Do not submit the form. Guard every mutating API request; only strict metadata-free dry-run `reserveSlot` input(s) may pass. Exclude archived copies from Playwright discovery and confirm intended test count before execution. Record fallback/network failures rather than reporting them as passing UI checks.
- [ ] Recheck schema/env/event/proxy/container invariants. Inspect screenshots. On real application/health regression, use verified rollback. Retain release log/verification evidence; clean only owned disposable DB/swap/staging, using recoverable archive for reusable materials. Record completion and limitations in this plan; do not merge/push without user direction.
