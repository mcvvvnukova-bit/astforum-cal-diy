# Widget Action Colors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development for the source task and independent review. Steps use checkbox syntax.

**Goal:** Apply the approved Forum orange states to primary actions only in the embedded demo booking widget.

**Architecture:** Reuse `useDemoWidgetPresentation()` and add an opt-in CSS-module class to the two existing primary action consumers. Bind verified Forum / Light colors through semantic Primer button variables in that module. Do not change shared button primitives or global branding settings.

**Tech Stack:** Existing React/Next.js Cal.diy fork, CSS Modules, Vitest, Docker, guarded Playwright.

## Global Constraints

- Only embedded `demo/60min`; non-embedded pages, other events, admin, landing page buttons and booking behavior remain unchanged.
- Rest `#FF551A`, hover `#FF7140`, pressed `#E64A12`, text `#040404`; verified from Figma file `WT2IPB0eHD9ULCPENEktwp`, collection `Forum` (`VariableCollectionId:107:73`), mode `Light` (`107:0`) on 2026-09-10. Aliases: `color/bg/accent` → `primitive/accent`; `color/bg/accent-hover` → `primitive/accent-hover`; `color/bg/accent-pressed` → `primitive/accent-pressed`; `color/text/on-accent` → `primitive/black`.
- Back, close, month arrows, date selection and slot-selection buttons stay neutral. Only existing primary confirm/continue actions receive the class. Preserve disabled, loading, focus, keyboard and responsive behavior.
- User approved widget-only color adaptation of this existing third-party widget, not a component-library migration. No new dependencies, new UI primitives, schema/data mutations, dark mapping, or shared-component rewrite.
- Continue in `codex/demo-widget-display` as previously requested; no push, merge or PR. Keep unrelated work intact.
- Production changes affect only the web image. Preserve previous image/rollback; no production migrations, seeding, database or neighbor service restarts. Never submit or reserve a real booking for verification. Do not read stored landing credentials.

## Task 1: Scoped primary action theme and regression coverage

**Files:**
- Create `apps/web/modules/bookings/components/DemoWidgetActions.module.css`.
- Modify `apps/web/modules/bookings/components/AvailableTimes.tsx` and `apps/web/modules/bookings/components/BookEventForm/BookEventForm.tsx`.
- Extend `apps/web/modules/bookings/components/BookEventForm/BookEventForm.demo.test.tsx`; add focused primary-action consumer test under the same bookings component test conventions when needed for `AvailableTimes`.

**Interfaces:** Existing `useDemoWidgetPresentation(): boolean` and CSS module export `primaryAction: string`. No changed public component signatures. Compose existing caller class names with the opt-in module class using the existing `classNames` helper (aliased in BookEventForm to avoid its prop name collision).

- [x] Write regression assertions before production edits. Render the real BookEventForm and AvailableTimes consumers with the existing real store test harness and mocked external boundary only. For target embed assert primary action contains the module class; direct event, other event/username assert it does not; back and time buttons must not have the class. Exercise disabled/loading semantics and caller class preservation.
- [x] Run the focused tests to RED. If the local fork lacks dependencies, ask the controller for the prepared server runtime rather than installing the monorepo or borrowing another plan's ignored workspace.
- [x] Add the CSS module. Place verified literal values only in the Forum token layer, alias them to `--button-primary-bgColor-rest`, `--button-primary-bgColor-hover`, `--button-primary-bgColor-active`, and `--button-primary-fgColor-rest`. Apply background/text/border only to `.primaryAction` and hover/active only with `:not(:disabled)`. Preserve native disabled/loading semantics; use existing subdued disabled opacity. Keep a visible focus ring (Forum `color/border/focus` aliases accent) with sufficient contrast. Never override layout/typography or use `!important` unless a measured cascade conflict requires it.
- [x] Add the class only to the current primary Button in SlotItem (`skip-confirm-book-button`) and BookEventForm (`confirm-book-button` or reschedule counterpart). Do not color time buttons or their neutral selected state.
- [x] Run focused tests to GREEN plus relevant existing demo consumer tests, Biome on changed sources, and type checking supported by the prepared runtime. Run the Primer validator and report legacy widget framework limitations honestly; do not expand into a migration.
- [x] Self-review and commit only the scoped source/test files. Write the report with exact RED/GREEN commands and output, file allowlist, token mapping, and limitations. The controller performs an independent task review before publication.

## Owner publication and verification checklist

- [x] Verify current image/digest/health and copy the durable previous release Dockerfile/build/publication/rollback recipe (not stored credentials) into this plan's own workspace. Adapt exact base image, source allowlist and new-file rollback handling.
- [x] Build the reviewed source revision against disposable build PostgreSQL with dummy build credentials. Keep production services untouched while building; publish with explicit `yarn start` web-only override after review.
- [x] Before/after compare deployed revision/image, production event/schema/config hashes, avatar and neighboring container IDs/start times. Preserve old image and reverse script.
- [x] Check real primary button computed rest/hover/pressed/focus/disabled states at desktop/tablet/mobile using the real embed in a local test host, block reservation/booking writes. Also inspect direct non-embedded page as a negative control. No claim of protected landing CTA verification without authorized access.
- [x] Record actual result and limitations in this plan, keep branch and rollback, and report the user-visible outcome.

## Verified release result

- Runtime commit: `a1a976c5e3fc0029bcdf342d04540aae86121640`; test-only follow-up: `0098f13b5b5b47312a2941f53762ac7197304d9f`. No runtime source changed after the built commit.
- Published image: `astforum/cal-diy:a1a976c5e3fc`, immutable ID `sha256:ae6994656ae304cff864c4e4c92ba1067da44e6617dfa2b0e483d654314354d3`.
- Production build exited 0: Next compiled successfully in 2.8 min, TypeScript completed in 3.0 min, static page generation succeeded. Only web was recreated; final health `healthy`.
- Regression RED: 4 expected missing-class failures, 11 passed. Final GREEN: 36/36 across BookEventForm, AvailableTimes, DemoSlotPresentation and EventMeta, 20.07 s. Biome: 0 errors on five original changed files and on the final two amended tests.
- Independent task review required separate loading-only assertions with the real spinner; fixed and accepted. Broad branch/release review required removing runtime environment inspection; removed before publication, then accepted. No open Critical/Important findings.
- Chromium desktop 1440×1000, tablet 820×1180, mobile 390×844: primary rest/hover/pressed exactly `#FF551A`/`#FF7140`/`#E64A12`, text `#040404`, keyboard outline 2px accent, simulated disabled CSS opacity 0.3. Actual loading/disabled prop semantics covered by consumer tests. Neutral time and Back buttons unchanged.
- Direct, non-embedded `demo/60min` negative control remained `rgb(41,41,41)` with white text. The live production iframe was exercised through the landing's actual embed module in a local test host. Protected `dev.astforum.ru` authentication/CTA itself was not tested.
- Browser write interception blocked each attempted `POST /api/trpc/slots/reserveSlot`; no booking/reservation or final submission was sent. Service workers were blocked. Desktop and mobile screenshots visually inspected; the test's pressed-state mouse release was corrected to the visible gap before submit to avoid backdrop dismissal.
- Event confirmation/location/timezone settings, avatar/brandColor, Prisma schema, Compose/proxy configs and existing database/redis/Outline/pgAdmin/landing-auth container IDs/start times were unchanged. Four mail service containers were additionally compared and unchanged. No `.env` or stored password contents were read; no runtime-secret hash claim is made.

## Operations and retained rollback

Durable release directory on `forum-prod`:
`/opt/astforum-cal-diy/releases/a1a976c5e3fc0029bcdf342d04540aae86121640`.

The existing `.env` was not modified. Future Compose commands must include both the source Compose file and this release's `web-command.override.yaml`, which pins the new image and `command: ["yarn", "start"]`.

Previous image `astforum/cal-diy:42d0fbb05f0b` remains available. To roll back only this web release:

```sh
sudo bash /opt/astforum-cal-diy/releases/a1a976c5e3fc0029bcdf342d04540aae86121640/rollback-release.sh a1a976c5e3fc0029bcdf342d04540aae86121640
```

Rollback script and source backup are retained; rollback was reviewed, not executed against the successful release. Temporary build PostgreSQL and 8GB swap were removed by the build script. Branch retained; no push, merge or PR.

## Known verification limitations

- Initial focused tsc at 1536MB exited 134 (V8 OOM); the subsequent full production build's TypeScript gate passed at the normal 4096MB heap.
- Focused tests retain a pre-existing nested Salesforce `vi.mock` warning in shared setup. Biome retains legacy warning/info diagnostics; 0 errors is not a claim of warning-free output.
- Primer whole-project validator exited 2 at the existing `.claude/rules` symlink. This was not a passing framework-compliance scan or a migration of Cal.diy's existing Button to Primer.
- This was scoped consumer/build/browser verification, not a full monorepo unit/E2E suite or a real booking flow submission.
