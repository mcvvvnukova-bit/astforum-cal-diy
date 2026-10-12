import { chromium } from '/Users/vvv/Проекты/АСТ Форум/deployment/dev-landing/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const expected = process.argv[2] ?? 'МСК (GMT+3)';
const suffix = expected === 'МСК (GMT+3)' ? 'after' : 'before';
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
  const blocked = [];
  await context.route('https://cal.astforum.ru/**', async route => {
    const request = route.request();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.continue();
    blocked.push(`${request.method()} ${new URL(request.url()).pathname}`);
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
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
  const day = frame.locator('[data-testid="day"]:not([disabled])').first();
  await day.waitFor({ timeout: 90000 });
  await day.click();
  const footer = frame.getByTestId('demo-slot-timezone').filter({ visible: true });
  await footer.waitFor({ state: 'visible' });
  await footer.scrollIntoViewIfNeeded();
  assert.equal((await footer.textContent()).trim(), expected);
  assert.equal(await footer.locator('button,input,select,[role="combobox"],[tabindex]').count(), 0);
  assert.equal(await footer.evaluate(el => getComputedStyle(el).cursor), 'default');
  const rect = await footer.boundingBox();
  assert.ok(rect && rect.width > 0 && rect.height > 0);
  await footer.hover();
  assert.equal(await frame.getByRole('tooltip').count(), 0);
  assert.deepEqual(blocked, []);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: resolve(import.meta.dirname, `label-${suffix}.png`) });
  const result = { expected, actual: (await footer.textContent()).trim(), rect, blocked, errors, bookingSubmitted: false };
  await writeFile(resolve(import.meta.dirname, `smoke-${suffix}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
