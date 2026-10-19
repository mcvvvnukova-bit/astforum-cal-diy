# Widget Selected Day Implementation Plan

> **For agentic workers:** Use subagent-driven-development for the scoped source task and independent review. User approved orange selected-day fill and previously chose current branch plus independent agents.

**Goal:** Make the selected calendar day match the approved Forum primary-action palette, only in the embedded demo widget.

**Architecture:** Opt the app-level DatePicker consumer into a scoped CSS-module class using the existing strict demo embed predicate. Reuse the existing verified Forum token definitions. Target the existing shared calendar selected-day class only within that opt-in container; do not modify the shared calendar API or global brand settings.

**Tech Stack:** Existing Cal.diy React/Next.js, CSS Modules, Vitest, Docker, guarded Playwright.

## Global Constraints

- Only embedded `demo/60min`. Direct pages, other events/users, admin and landing controls remain unchanged.
- Selected-day rest `#FF551A`, hover `#FF7140`, pressed `#E64A12`, numeral/today marker `#040404`; reuse verified Forum / Light tokens already in DemoWidgetActions.module.css. User explicitly approved the same palette as the primary buttons.
- Other days remain unchanged, including unavailable days and the unselected today marker. Preserve date selection, keyboard focus, callback behavior, loading, dimensions, typography and responsive layout.
- No shared package edits, new primitives/dependencies, data/schema changes, dark theme mapping or framework migration. The user requested adapting this existing widget, not rebuilding it with another library.
- Keep branch `codex/demo-widget-display`; no worktree, push, merge or PR. Preserve unrelated changes.
- Publication is web-only with retained rollback. No production migrations or database/neighbor restarts. Never read .env/password contents or runtime secret values. Browser verification must block reservation and booking writes.

## Task 1: Scoped selected-day color and regression test

**Files:**
- Modify `apps/web/modules/bookings/components/DatePicker.tsx`.
- Modify `apps/web/modules/bookings/components/DemoWidgetActions.module.css`.
- Create `apps/web/modules/bookings/components/DatePicker.demo.test.tsx`.

**Interfaces:** Existing `useDemoWidgetPresentation(): boolean`, CSS export `selectedDayCalendar: string`, existing `DatePickerComponent.className`. Alias classNames helper to avoid prop collision. Shared calendar has no selected-day override: `datePickerDatesActive` styles UNSELECTED available days, so do not use that prop for this task.

- [x] Write test first with real app DatePicker + real shared DatePicker + real Booker store test harness. Mock only embed/locale and actual external boundaries. Fix now to a deterministic September2026 date with real timers if possible. Provide available days via slots and verify selected day, one other available day, disabled day, and today marker. Assert scoped container class only for demo embed and preserve caller container class; direct page, other slug and other username get no opt-in. Click a different available date and verify store/callback and changed selected element; unavailable day remains disabled. The named upstream assumption is that only selected Day receives bg-brand-default; characterize this because the safe app-only CSS relies on it.

```tsx
// Use real consumer/store, not a mocked DatePicker component.
expect(selectedDay).toHaveClass("bg-brand-default");
expect(otherAvailableDay).not.toHaveClass("bg-brand-default");
expect(container.className).toMatch(/selectedDayCalendar/);
expect(container).toHaveClass("caller-calendar");
```

- [x] Parent runs focused test RED in prepared isolated no-network container; wait for expected missing scope class failure before source edit. No local dependency installation.
- [x] Add predicate and compose class into existing root, no new DOM or prop signatures:

```tsx
const isDemoWidget = useDemoWidgetPresentation();
// Existing DatePickerComponent:
className={classNamesHelper(classNames?.datePickerContainer, isDemoWidget && demoWidgetActions.selectedDayCalendar)}
```

- [x] Reuse token layer by adding `.selectedDayCalendar` next to `.primaryAction` in its token-definition selector. Style selected non-disabled `button[data-testid="day"].bg-brand-default` only beneath the scoped class, with semantic aliases to existing Forum palette. Group with current primaryAction declarations or write selected-calendar rules using existing semantic tokens; do not duplicate primitive literals. Hover/active on selected enabled day only; preserve a visible focus ring. For selected today marker set background to currentColor within that selected button only. Unselected, disabled, navigation and existing primary styles unchanged. Explain this selected-class dependency in one why-comment if necessary.

```css
.selectedDayCalendar button[data-testid="day"][class~="bg-brand-default"]:not(:disabled) {
  background-color: var(--forum-color-bg-accent);
  color: var(--forum-color-text-on-accent);
}
```

- [x] Parent runs GREEN focused test plus prior four demo consumer files, Biome on changed3files, and full normal build/TypeScript gate with disposable DB. Run Primer validator, record known legacy symlink/framework limitations honestly. Do not claim pristine warnings or full monorepo coverage.
- [x] Self-review and commit only3source/test files after covering tests and appropriate checks; report exact RED/GREEN evidence. Independent reviewer checks scope and CSS selector coupling.

Use standard CSS `[class~="..."]` token selectors for the existing global classes, since the repository Biome parser does not enable `:global`. No lint configuration change is required.

## Owner release checklist

- [x] Create own stage and isolated test runtime from current a1a976c image; reuse durable previous recipe, not another plan's ignored workspace.
- [x] Verify current image/digest and adapt allowlist/rollback to3files. Build from current production base with overlay, dummy disposable PostgreSQL and temporary swap. No runtime secret inspection.
- [x] Review source and release changes independently; publish only healthy new web with pinned image/yarn-start override. Compare event/avatar/schema/config and all neighboring container IDs/start times.
- [x] Guarded browser: desktop/tablet/mobile selected date rest/hover/pressed/focus, selection transfer, selected/unselected today marker, unchanged available/disabled colors, direct-page negative control. Do not click time slots or submit bookings. Also confirm existing action theme through its consumer tests or guarded form smoke.
- [x] Record result/limitations/rollback in this plan, keep branch and archive only this plan's scratch.

## Release result — 2026-09-11

- Source commit `b40981cbcf6a091992a6777b8135ea2cbaf65c95`; only the three planned source/test files.
- Production image `astforum/cal-diy:b40981cbcf6a`, immutable ID `sha256:2e88994648514deadb588b0b141c471b4521b32fb6925c2ef5f7fc30673e4b57`. Web healthy, command `yarn start`, public page HTTP200.
- RED: real DatePicker test failed the missing scope-class assertion before implementation (1failed/3passed). Final GREEN: 40/40 in five demo consumer files, 39.79s. Final Biome on three changed files and focused TypeScript both exit0.
- Full Next production build including TypeScript passed (builder step386.8s); dummy disposable PostgreSQL only. Initial launch exited2 with no log; a traced retry completed. Test container, disposable build DB and owned temporary swaps were removed.
- Source and whole-branch/release independent reviews approved with no critical/important issues. Existing shared Salesforce mock warning remains deferred. Primer validator exited2 on the pre-existing .claude/rules directory symlink; no passing Primer gate or component-framework migration is claimed. Full monorepo test suite was not run.
- Post-release browser: desktop1440×1000, tablet820×1180, mobile390×844 embeds and direct-page control all PASS. Verified rest#FF551A, hover#FF7140, pressed#E64A12, numeral/selected-today marker#040404, focus outline, keyboard/date selection transfer. Unselected/disabled colors and dimensions match baseline; direct page remains dark. Screenshots visually checked. CSS transitions are awaited before color assertions.
- Verification used the landing's existing embed module in a guarded local host against production Cal.diy. Non-read HTTP requests were blocked; no time slots were clicked or bookings submitted.
- Event3 manual confirmation/location/timezone, user1 avatar/brand, Prisma schema, server Compose/proxy configs and12neighbor container IDs/start times unchanged. No .env/password contents read, no production migrations.
- Existing mobile date/timezone presentation seen in baseline remains outside this selected-day-only change.
- Unrelated dirty deployment/astforum/README.md, compose.yaml and env.example were preserved and excluded from commit/overlay.

### Reproduction and rollback

Durable server recipe and verification evidence:
`/opt/astforum-cal-diy/releases/b40981cbcf6a091992a6777b8135ea2cbaf65c95`.

Future Compose operations must include that release's `web-command.override.yaml` to retain the pinned image and `yarn start` command. Existing server .env is consumed by Compose without inspection or editing.

Rollback only web to previous image:
`sudo bash /opt/astforum-cal-diy/releases/b40981cbcf6a091992a6777b8135ea2cbaf65c95/rollback-release.sh b40981cbcf6a091992a6777b8135ea2cbaf65c95`.

Previous image `astforum/cal-diy:a1a976c5e3fc` and source overlay are retained. Branch `codex/demo-widget-display` kept as requested; no push, merge or PR.
