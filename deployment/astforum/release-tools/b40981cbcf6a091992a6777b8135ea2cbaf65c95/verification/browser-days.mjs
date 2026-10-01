import { chromium } from '/Users/vvv/Проекты/АСТ Форум/deployment/dev-landing/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseline = process.argv.includes('--baseline');
const browser = await chromium.launch();
const evidence = [];
const before = baseline ? null : JSON.parse(await readFile(resolve(import.meta.dirname,'browser-days-before.json'),'utf8'));
const waitColor = (locator, expected, property = 'backgroundColor') => locator.evaluate((el, { expected, property }) => new Promise((resolve, reject) => {
  const start=performance.now();
  const check=()=> {
    const actual=getComputedStyle(el)[property];
    if(actual===expected) return resolve(actual);
    if(performance.now()-start>4000) return reject(new Error(`Expected ${property} ${expected}, got ${actual}`));
    requestAnimationFrame(check);
  };
  check();
}), { expected, property });
const waitBackground = (locator, expected) => waitColor(locator, expected);
const style = locator => locator.evaluate(el => {
  const c = getComputedStyle(el), r = el.getBoundingClientRect();
  return { text: el.textContent, background: c.backgroundColor, color: c.color, border: c.borderColor, outline: c.outlineColor, outlineWidth: c.outlineWidth, outlineStyle: c.outlineStyle, disabled: el.disabled, x: r.x, width: r.width, viewport: innerWidth, focused: document.activeElement === el };
});
try {
  for (const [name,width,height,embedded] of [['desktop',1440,1000,true],['tablet',820,1180,true],['mobile',390,844,true],['direct',1440,1000,false]]) {
    const context = await browser.newContext({ viewport: {width,height}, locale:'ru-RU', timezoneId:'Europe/Moscow', serviceWorkers:'block' });
    const blocked = [];
    await context.route('https://cal.astforum.ru/**', route => {
      if (['GET','HEAD','OPTIONS'].includes(route.request().method())) return route.continue();
      blocked.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    let surface = page;
    if (embedded) {
      await page.route('http://127.0.0.1:4176/widget-days-check', route => route.fulfill({ contentType:'text/html', body:'<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><button id="open">Выбрать время</button><script type="module">import {openDemoBooking} from "/src/landing/cal-diy-embed.ts";document.getElementById("open").onclick=()=>openDemoBooking();</script></html>' }));
      await page.goto('http://127.0.0.1:4176/widget-days-check');
      await page.getByRole('button',{name:'Выбрать время'}).click();
      surface=page.frameLocator('iframe');
    } else await page.goto('https://cal.astforum.ru/demo/60min');
    await surface.getByTestId('event-meta').waitFor({timeout:60000});
    const days = surface.locator('button[data-testid="day"]');
    const enabled = surface.locator('button[data-testid="day"]:not(:disabled)');
    await enabled.first().waitFor({timeout:60000});
    // Today remains real. Pick first available date, then transfer selection to another available date.
    const first = enabled.first();
    await first.click();
    await page.mouse.move(0,0);
    const selected = surface.locator('button[data-testid="day"].bg-brand-default:not(:disabled)');
    await selected.waitFor();
    await waitBackground(first, !baseline && embedded ? 'rgb(255, 85, 26)' : 'rgb(41, 41, 41)');
    const firstLabel = await first.innerText();
    const rest = await style(first);
    const neutral = await style(surface.locator('button[data-testid="day"]:not(:disabled):not(.bg-brand-default)').first());
    const unavailable = await style(surface.locator('button[data-testid="day"]:disabled').first());
    assert.equal(neutral.background,'rgb(229, 231, 235)');
    assert.ok(unavailable.disabled);
    if (!baseline && embedded) {
      assert.equal(rest.background,'rgb(255, 85, 26)');
      assert.equal(rest.color,'rgb(4, 4, 4)');
    } else assert.equal(rest.background,'rgb(41, 41, 41)');
    assert.ok(rest.width > 0 && rest.x >= 0 && rest.x + rest.width <= rest.viewport + 1);
    const marker = first.locator('span.bg-brand-accent');
    const selectedToday = await marker.count() ? await style(marker) : null;
    if (selectedToday && !baseline && embedded) assert.equal(selectedToday.background,'rgb(4, 4, 4)');
    await first.hover();
    if(!baseline && embedded) await waitBackground(first,'rgb(255, 113, 64)');
    const hover=await style(first);
    await page.mouse.down();
    if(!baseline && embedded) await waitBackground(first,'rgb(230, 74, 18)');
    const pressed=await style(first);
    // Same-date click is safe and never reserves a slot.
    await page.mouse.up();
    await page.mouse.move(0,0);
    if (!baseline && embedded) {
      assert.equal(hover.background,'rgb(255, 113, 64)');
      assert.equal(pressed.background,'rgb(230, 74, 18)');
    }
    const nextIndex = await surface.locator('button[data-testid="day"]:not(:disabled):not(.bg-brand-default)').first().evaluate(el => Array.from(document.querySelectorAll('button[data-testid="day"]')).indexOf(el));
    const next = days.nth(nextIndex);
    await next.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Enter');
    await next.focus();
    await waitBackground(next,!baseline && embedded ? 'rgb(255, 85, 26)' : 'rgb(41, 41, 41)');
    if (!baseline && embedded) await waitColor(next,'rgb(255, 85, 26)','outlineColor');
    const focused=await style(next);
    assert.ok(focused.focused);
    assert.notEqual(await next.innerText(),firstLabel);
    assert.ok(!(await first.getAttribute('class')).split(' ').includes('bg-brand-default'));
    if (!baseline && embedded) {
      assert.equal(focused.background,'rgb(255, 85, 26)');
      assert.equal(focused.outline,'rgb(255, 85, 26)');
      assert.ok(parseFloat(focused.outlineWidth)>=2 && focused.outlineStyle==='solid');
    }
    await waitBackground(first,neutral.background);
    const old=await style(first);
    assert.equal(old.background,neutral.background);
    const oldToday=await first.locator('span.bg-brand-default').count() ? await style(first.locator('span.bg-brand-default')) : null;
    if(oldToday) assert.equal(oldToday.background,'rgb(41, 41, 41)');
    await page.screenshot({path:resolve(import.meta.dirname,`${name}-day-${baseline?'before':'after'}.png`)});
    if (embedded) assert.ok(await page.locator('iframe').isVisible(), 'Booking iframe remains visible');
    assert.equal(blocked.length,0);
    if (before) {
      const prior = before.evidence.find(item => item.name === name);
      assert.equal(rest.width, prior.rest.width, `${name}: day dimensions unchanged`);
      for (const key of ['background','color','width','disabled']) {
        assert.equal(neutral[key], prior.neutral[key], `${name}: unselected ${key} unchanged`);
        assert.equal(unavailable[key], prior.unavailable[key], `${name}: unavailable ${key} unchanged`);
      }
      if (!embedded) for (const key of ['background','color','width']) assert.equal(rest[key],prior.rest[key],`direct: ${key} unchanged`);
    }
    evidence.push({name,rest,neutral,unavailable,selectedToday,hover,pressed,focused,old,oldToday,blocked,dayCount:await days.count()});
    console.log(`${name}: PASS`);
    await context.close();
  }
  await writeFile(resolve(import.meta.dirname,`browser-days-${baseline?'before':'verified'}.json`),JSON.stringify({evidence,noBookingWrites:true},null,2));
} finally { await browser.close(); }
