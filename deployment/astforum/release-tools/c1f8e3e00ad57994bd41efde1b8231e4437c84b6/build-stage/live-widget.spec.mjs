import { test, expect } from '/Users/vvv/Проекты/АСТ Форум/deployment/dev-landing/node_modules/playwright/test.mjs';
import { execFileSync } from 'node:child_process';
import { allowCalRequest } from './request-guard.mjs';

for (const viewport of [{ width: 1440, height: 1100 }, { width: 390, height: 844 }]) {
  test(`demo booking second step ${viewport.width}`, async ({ page, context }, testInfo) => {
    await page.setViewportSize(viewport);
    const blocked = [];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('https://cal.astforum.ru/api/**', async route => {
      const req = route.request();
      if (allowCalRequest(req.method(), req.url(), req.postData())) return route.continue();
      blocked.push(`${req.method()} ${new URL(req.url()).pathname}`);
      await route.abort('blockedbyclient');
    });
    await context.addInitScript(() => {
      if (location.origin === 'https://cal.astforum.ru') localStorage.setItem('timeOption.is24hClock', 'false');
    });
    await page.goto('https://dev.astforum.ru', { waitUntil: 'domcontentloaded' });
    if (await page.getByLabel(/^Пароль/).count()) {
      const password = execFileSync('ssh', ['forum-prod', 'sudo cat /opt/outline/secrets/dev_landing_password'], { encoding: 'utf8' }).trim();
      await page.getByLabel(/^Пароль/).fill(password);
      await page.getByRole('button', { name: 'Войти', exact: true }).click();
    }
    await page.getByRole('link', { name: 'Выбрать время', exact: true }).click();
    const iframe = page.locator('cal-modal-box iframe').filter({ visible: true });
    await iframe.waitFor({ state: 'visible', timeout: 90000 });
    const frame = await (await iframe.elementHandle()).contentFrame();
    await frame.getByRole('button', { name: /^\d{1,2}:\d{2}$/ }).first().waitFor({ timeout: 90000 });
    await expect(frame.getByTestId('event-meta-current-timezone')).toContainText('Europe/Moscow');
    await expect(frame.getByText('по московскому времени (GMT+3)', { exact: true })).toHaveCount(0);
    const url = new URL(frame.url());
    url.searchParams.set('cal.isBookingDryRun', 'true');
    await frame.goto(url.href, { waitUntil: 'domcontentloaded' });
    await frame.getByRole('button', { name: /^\d{1,2}:\d{2}$/ }).first().click({ timeout: 60000 });
    const next = frame.getByRole('button', { name: /^(Далее|Next)$/ });
    if (await next.count()) await next.click();
    await frame.locator('input[type="email"]').waitFor({ timeout: 30000 });
    const phone = frame.locator('input[type="tel"]').first();
    await expect(phone).toBeVisible();
    await expect(frame.locator('.flag.ru')).toHaveCount(1);
    await expect(frame.locator('.selected-flag .arrow')).toHaveCount(0);
    await expect.poll(async () => (await phone.inputValue()).replace(/\D/g, '')).toBe('7');
    const field = phone.locator('xpath=ancestor::*[@data-fob-field-name][1]');
    await expect(field.getByLabel('Пожалуйста, введите номер в международном формате.', { exact: true })).toHaveCount(0);
    await frame.locator('.selected-flag').click();
    await expect(frame.locator('.country-list')).toHaveCount(0);
    await phone.press('ControlOrMeta+A');
    await phone.press('Backspace');
    await expect.poll(async () => (await phone.inputValue()).replace(/\D/g, '')).toBe('7');
    await phone.press('End');
    await phone.pressSequentially('9991234567');
    await expect.poll(async () => (await phone.inputValue()).replace(/\D/g, '')).toBe('79991234567');
    await phone.press('ArrowDown');
    await expect(frame.locator('.country-list')).toHaveCount(0);
    await phone.fill('+12025550123');
    await expect.poll(async () => (await phone.inputValue()).replace(/\D/g, '')).toBe('79991234567');
    await phone.fill('+7 (999) 123-45-67');
    await expect.poll(async () => (await phone.inputValue()).replace(/\D/g, '')).toBe('79991234567');
    const zone = frame.getByText('по московскому времени (GMT+3)', { exact: true });
    await expect(zone).toBeVisible();
    const meta = frame.getByTestId('event-meta');
    const duration = meta.getByText(/^(1ч|1 ч|1 час)$/);
    await expect(duration).toBeVisible();
    const zoneBox = await zone.boundingBox();
    const durationBox = await duration.boundingBox();
    expect(zoneBox.y).toBeLessThan(durationBox.y);
    const agreement = frame.locator('form').getByText(/Продолжая, вы соглашаетесь/);
    await expect(agreement).toHaveText('Продолжая, вы соглашаетесь с условиями использования и политикой конфиденциальности.');
    await expect(agreement.getByRole('link')).toHaveCount(2);
    await expect(agreement.getByRole('link').first()).toHaveAttribute('target', '_blank');
    await expect(agreement.getByRole('link').last()).toHaveAttribute('target', '_blank');
    await expect(agreement.getByRole('link').first()).toHaveAttribute('href', 'https://cal.com/terms');
    await expect(agreement.getByRole('link').last()).toHaveAttribute('href', 'https://cal.com/privacy');
    await page.screenshot({ path: testInfo.outputPath(`demo-form-${viewport.width}.png`), fullPage: false });
    await frame.getByTestId('back').click();
    await frame.getByRole('button', { name: /^\d{1,2}:\d{2}$/ }).first().click();
    if (await next.count()) await next.click();
    await expect.poll(async () => (await phone.inputValue()).replace(/\D/g, '')).toBe('79991234567');
    await expect(frame.locator('.flag.ru')).toHaveCount(1);
    expect(errors).toEqual([]);
    expect(blocked).toEqual([]);
  });
}

for (const prefillCase of [
  { title: 'preserves a formatted initial Russian phone prefill', value: '+7 (999) 123-45-67', expectedDigits: '79991234567' },
  { title: 'does not convert an initial foreign phone prefill into a Russian number', value: '+12025550123', expectedDigits: '7' },
]) {
  test(`demo booking ${prefillCase.title}`, async ({ page, context }) => {
    const blocked = [];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('https://cal.astforum.ru/api/**', async route => {
      const req = route.request();
      if (allowCalRequest(req.method(), req.url(), req.postData())) return route.continue();
      blocked.push(`${req.method()} ${new URL(req.url()).pathname}`);
      await route.abort('blockedbyclient');
    });
    await page.goto('https://dev.astforum.ru', { waitUntil: 'domcontentloaded' });
    if (await page.getByLabel(/^Пароль/).count()) {
      const password = execFileSync('ssh', ['forum-prod', 'sudo cat /opt/outline/secrets/dev_landing_password'], { encoding: 'utf8' }).trim();
      await page.getByLabel(/^Пароль/).fill(password);
      await page.getByRole('button', { name: 'Войти', exact: true }).click();
    }
    await page.getByRole('link', { name: 'Выбрать время', exact: true }).click();
    const iframe = page.locator('cal-modal-box iframe').filter({ visible: true });
    await iframe.waitFor({ state: 'visible', timeout: 90000 });
    const frame = await (await iframe.elementHandle()).contentFrame();
    await frame.getByRole('button', { name: /^\d{1,2}:\d{2}$/ }).first().waitFor({ timeout: 90000 });
    const url = new URL(frame.url());
    url.searchParams.set('cal.isBookingDryRun', 'true');
    url.searchParams.set('attendeePhoneNumber', prefillCase.value);
    await frame.goto(url.href, { waitUntil: 'domcontentloaded' });
    await frame.getByRole('button', { name: /^\d{1,2}:\d{2}$/ }).first().click({ timeout: 60000 });
    const next = frame.getByRole('button', { name: /^(Далее|Next)$/ });
    if (await next.count()) await next.click();
    const phone = frame.locator('input[name="attendeePhoneNumber"]');
    await expect(phone).toBeVisible({ timeout: 30000 });
    await expect.poll(async () => (await phone.inputValue()).replace(/\D/g, '')).toBe(prefillCase.expectedDigits);
    await expect(frame.locator('.flag.ru')).toHaveCount(1);
    expect(errors).toEqual([]);
    expect(blocked).toEqual([]);
  });
}

test('direct event retains its original presentation', async ({ page, context }) => {
  await context.route('https://cal.astforum.ru/api/**', async route => {
    const request = route.request();
    if (allowCalRequest(request.method(), request.url(), request.postData())) return route.continue();
    await route.abort('blockedbyclient');
  });
  await page.goto('https://cal.astforum.ru/demo/60min', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('event-meta')).toBeVisible({ timeout: 90000 });
  await expect(page.getByText('Требуется подтверждение', { exact: true })).toBeVisible();
  await expect(page.getByText('Cal Video', { exact: true })).toBeVisible();
  await expect(page.getByText('по московскому времени (GMT+3)', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('event-meta-current-timezone')).toContainText('Europe/Moscow');
  await expect(page.getByRole('radio', { name: '24ч', exact: true })).toBeVisible();
});
