# Demo Booking Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the four approved presentation changes to the second step of the embedded demo booking form and publish them to the AST Forum VPS.

**Architecture:** Reuse the existing embed/event predicate at booking-owned boundaries and pass optional presentation parameters to shared phone/form components. Keep timezone calculation, event data, validation and non-target behavior unchanged. Rebuild the existing pinned application with unchanged dependencies and deploy only its web container.

**Tech Stack:** Cal.diy, React/Next.js, react-hook-form, react-phone-input-2, existing translation dictionaries, Vitest/Testing Library, Playwright, Docker.

**Spec:** `docs/superpowers/specs/2026-09-08-demo-booking-form-design.md` (approved).

## Global Constraints

- Only the second step of embedded `demo/60min` on `cal.astforum.ru`; the landing CTA is on `dev.astforum.ru`. Direct non-embedded pages, other events, admin forms and first-step timezone controls retain existing behavior.
- No phone information icon/tooltip. Russian flag only, no dropdown/arrow or keyboard country selection, initial and fixed `+7`, no GeoIP/browser-driven country change. Preserve valid Russian prefills and back/forward form state; do not silently convert a foreign international number into a valid Russian number.
- Russian agreement text: «Продолжая, вы соглашаетесь с условиями использования и политикой конфиденциальности». Preserve both existing links and their targets. Remove only the app name in this agreement block.
- Display «по московскому времени (GMT+3)» only when the actual timezone is `Europe/Moscow`; show the real zone otherwise. Put timezone above duration on the second step; preserve duration value and formatting.
- Preserve manual confirmation, booking settings, meeting provider, existing validation and previous 24-hour/presentation changes. No new backend country validation, dependencies, DB schema/data changes, mail changes, or neighboring service restarts.
- Use native components and explicit opt-in props; no iframe CSS/DOM injection, no new obligatory Booker context in shared components. Add UI copy to English/Russian dictionaries.
- No real booking, mail or non-dry-run reservation during verification. Build uses disposable DB/dummy secrets; production starts directly with `yarn start`, without migrations/seeding, including rollback.

## Task 1: Scoped form implementation and focused tests

**Files:**
- Modify `apps/web/components/phone-input/PhoneInput.tsx`: optional fixed-country behavior, unchanged default path.
- Modify `apps/web/modules/form-builder/components/FormBuilderField.tsx`: optional phone presentation parameter, label/phone rendering integration.
- Modify `apps/web/modules/bookings/components/BookEventForm/BookingFields.tsx`: enable opt-in for target booking phone fields only.
- Modify `apps/web/modules/bookings/components/BookEventForm/BookEventForm.tsx`: choose agreement translation without product name only for target.
- Modify `apps/web/modules/bookings/components/EventMeta.tsx`: target second-step timezone label/order.
- Modify `packages/i18n/locales/en/common.json` and `packages/i18n/locales/ru/common.json`: two scoped translation keys.
- Add up to two focused component test files beside the above components; cover real rendered behavior, not source-string matching. Existing phone-mask tests remain unchanged.

**Interfaces:** Consume `useDemoWidgetPresentation(): boolean` from the existing features hook and `useBookerStoreContext(state => state.state)` at booking-owned boundaries. Produce an optional `fixedCountry?: "ru"` on `PhoneInputProps`, and an optional phone presentation prop on `FormBuilderField` passed through to its internal renderer. Defaults must preserve all existing callers. Keep the general form-builder widget types unchanged by handling the opt-in phone renderer within `FormBuilderField` when needed.

- [x] Read repository AGENTS and the relevant TDD/React instructions; inspect installed phone library props before relying on them. The owner provides an isolated check helper based on the current image, not production-container execution.
- [x] Add failing tests with real phone rendering and real booking/form consumers. Use existing Booker test utilities for event context; mock only external embed/GeoIP/locale boundaries. Before implementation, demonstrate missing target behavior with these literal assertions:

```tsx
expect(container.querySelector('.flag.ru')).not.toBeNull();
expect(container.querySelector('.selected-flag .arrow')).toBeNull();
expect(phone.value.replace(/\D/g, '')).toBe('7');
fireEvent.click(container.querySelector('.selected-flag')!);
expect(container.querySelector('.country-list')).toBeNull();
expect(screen.queryByText('number_in_international_format')).not.toBeInTheDocument();
// After typing/pasting a test number and back/forward navigation:
expect(phone.value.replace(/\D/g, '')).toBe('79991234567');
// Render target agreement with real RU resources and assert no app-name suffix;
// both links still expose the unchanged WEBSITE_TERMS_URL / PRIVACY_POLICY_URL.
expect(agreement.textContent).not.toContain('Cal.diy');
expect(timezone.textContent).toBe('по московскому времени (GMT+3)');
expect(timezone.compareDocumentPosition(duration) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
```

- [x] Run tests to RED with the owner-provided check helper. Cover target, non-embedded same event, other embedded event, fixed prefix/delete/paste, default international phone behavior, actual non-Moscow timezone and unchanged first step. Name the missing production behavior each test catches in the report.
- [x] Implement the smallest passing change. Fixed phone mode uses existing library capabilities (`country="ru"`, `onlyCountries={["ru"]}`, `disableDropdown`, `countryCodeEditable={false}`, country guessing disabled where supported), plus narrowly scoped handling only if actual library tests show it necessary. A single explicit opt-in path prevents store/GeoIP from overriding the fixed country. Use real field names/required state and preserve form values; malformed/pasted foreign values must not become silently valid Russian numbers.

```tsx
const isDemoWidget = useDemoWidgetPresentation();
const isDemoBookingStep = isDemoWidget && bookerState === 'booking';
// At the booking-owned boundary, pass the phone override only to phone fields.
// In EventMeta, render the normal EventDetails before the timezone for default
// mode, and after the timezone for isDemoBookingStep. Do not write either store.
const timezoneLabel = isDemoBookingStep && timezone === 'Europe/Moscow'
  ? t('demo_booking_moscow_time')
  : timezone;
```

- [x] Add `demo_booking_moscow_time` and `demo_booking_terms` to English/Russian resources. The RU terms value is `Продолжая, вы соглашаетесь с <0>условиями использования</0> и <1>политикой конфиденциальности</1>.`; EN value is `By continuing, you agree to the <0>Terms</0> and <1>Privacy Policy</1>.`. English zone value is `Moscow time (GMT+3)`. Use the existing ServerTrans link components, selecting the new key only for the target.
- [x] Run focused tests to GREEN plus existing FormBuilderField, phone-mask, EventDetails and scoped time tests. Run Biome on changed files. Type-check the changed code in the isolated runtime; the owner also runs the production Next.js/type build before publication. Keep changes under 500 code lines and 10 code files where feasible; report a concrete conflict rather than dropping coverage silently.
- [x] Self-review, commit only source/tests/translations after verification and write the report with RED/GREEN commands/output, modified files, scope proof and any concerns. No full production build, server deployment, push or database writes by the implementer.

## Task 2: Owner verification, safe build and deployment

**Inputs:** Reviewed Task 1 commit. Current expected parent image `astforum/cal-diy:4b68c798f285` with ID `sha256:9136c2a7263e1777483a0b62af399be80c513700b5d9fd92ad421b0a88e4caa3`; verify before use.

**Files:** Owner helpers/evidence in this plan's ignored workspace. Durable release recipe/logs and rollback configuration under a new revision-specific directory in `/opt/astforum-cal-diy/releases/`.

- [x] Read-only preflight: record image, service health, DB schema hash and event confirmation/location settings; hash secret contents without printing them. Check baseline focused tests in a disposable container with no production credentials.
- [x] Provide an isolated check helper that overlays this task's source/tests and Vitest config onto a disposable pinned-image container. `--network none`, `NODE_ENV=test`, `TZ=UTC`; never copy `.env`, never test in the production container.
- [x] Conduct task review, resolve findings through the implementer, then full change review. Preserve original reviewed BASE for review packages and exact source revision for the release.
- [x] Build a new pinned image from exact reviewed source and unchanged parent dependencies. Use a new disposable PostgreSQL initialized with dummy credentials, run `yarn workspace @calcom/web build`, and retain exit status/log. Run the long build independently of the SSH connection. No production DB/Redis credentials or endpoints during build.

```dockerfile
FROM astforum/cal-diy:4b68c798f285 AS builder
WORKDIR /calcom
COPY overlay/ ./
ARG BUILD_DATABASE_URL
RUN DATABASE_URL="$BUILD_DATABASE_URL" DATABASE_DIRECT_URL="$BUILD_DATABASE_URL" \
    NEXTAUTH_SECRET=build-only-dummy NEXT_PUBLIC_WEBAPP_URL=https://cal.astforum.ru \
    NEXTAUTH_URL=https://cal.astforum.ru/api/auth BUILD_STANDALONE=true \
    NODE_OPTIONS=--max-old-space-size=4096 yarn workspace @calcom/web build
FROM astforum/cal-diy:4b68c798f285
COPY --from=builder /calcom/apps/web /calcom/apps/web
COPY --from=builder /calcom/packages /calcom/packages
ARG VCS_REF
LABEL org.opencontainers.image.revision=$VCS_REF
CMD ["yarn", "start"]
```

- [x] Retain previous image/env/changed source for rollback; update only `CALDIY_IMAGE` and changed source files, then recreate web with `docker compose ... up -d --no-deps web`. Always supply an override setting web command to `["yarn", "start"]` in both forward and rollback commands. Leave other services running.
- [x] Verify desktop/mobile through the actual landing CTA. Select a slot only with `cal.isBookingDryRun=true`; intercept mutation requests and allow only strict `reserveSlot` requests whose parsed inputs all contain `_isDryRun: true`. Do not press the submission button. Confirm all four changes, +7/flag typing and paste, back/forward preservation, no country menu by pointer/keyboard, agreement links, correct timezone order, no first-step/direct-page regressions and no browser errors.
- [x] Recheck event settings, hashes and adjacent service health. If target behavior/health fails, restore prior web image using the migration-free override. Preserve release logs and rollback assets; remove only owned temporary build resources. Record verified outcome and remaining limitations in this plan.

## Completed release — 2026-09-08

- Source commit: `c1f8e3e00ad57994bd41efde1b8231e4437c84b6`; image `astforum/cal-diy:c1f8e3e00ad5` published and healthy.
- 28/28 focused/regression tests, full TypeScript and production build passed. Biome: zero errors; baseline-only warnings retained.
- Task review, full release review and scoped helper-fix review passed. Guard regression tests: 6/6, including SuperJSON metadata bypass rejection.
- Desktop/mobile, Russian/foreign initial prefills and direct-page control passed. Full current browser run passed 4/5; the fifth timed out before opening the iframe and followed the existing landing SDK fallback. Its isolated rerun passed. No application failure was observed in that case; network cause was not captured. Archived test copies were excluded from discovery before the final current-suite run.
- All four requested changes verified through the actual landing CTA without submitting bookings or sending mail. Screenshots were inspected visually.
- Manual confirmation, Moscow timezone lock, meeting provider, schema, secrets and neighboring container identities remain unchanged. Only web was recreated, directly with `yarn start`.
- Durable build/rollback and verification artifacts: `/opt/astforum-cal-diy/releases/c1f8e3e00ad57994bd41efde1b8231e4437c84b6`. Prior image retained. Disposable build DB/swap removed.
- Residual maintenance: pre-existing Salesforce mock warning; rollback intentionally not invoked on production. Source diff is 9 files and 595 changed lines, primarily real-consumer test coverage; no dependencies or schema changes.
- Current branch retained without merge/push. Task-owned review workspace/evidence retained until integration.
