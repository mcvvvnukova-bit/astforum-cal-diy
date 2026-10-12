import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowCalRequest } from './request-guard.mjs';
const root = 'https://cal.astforum.ru/api/trpc/slots/';
const dry = { json: { _isDryRun: true } };
test('permits only actual dry-run reservations among writes', () => {
  assert.equal(allowCalRequest('POST', root + 'reserveSlot', JSON.stringify(dry)), true);
  for (const body of [{ json: { _isDryRun: false } }, { json: { note: '_isDryRun: true' } }, { _isDryRun: true }, null]) {
    assert.equal(!!allowCalRequest('POST', root + 'reserveSlot', JSON.stringify(body)), false);
  }
});
test('rejects mixed batches and any non-dry member', () => {
  const body = JSON.stringify({ 0: dry, 1: dry });
  assert.equal(allowCalRequest('POST', root + 'reserveSlot,reserveSlot?batch=1', body), true);
  assert.equal(allowCalRequest('POST', root + 'reserveSlot,createBooking?batch=1', body), false);
  assert.equal(allowCalRequest('POST', root + 'reserveSlot,reserveSlot?batch=1', JSON.stringify({ 0: dry, 1: { json: { _isDryRun: false } } })), false);
});
test('rejects SuperJSON metadata on a single dry-run envelope', () => {
  for (const meta of [
    { values: { _isDryRun: ['undefined'] } },
    null,
    {},
    { values: {} },
  ]) {
    assert.equal(
      allowCalRequest('POST', root + 'reserveSlot', JSON.stringify({ ...dry, meta })),
      false,
    );
  }
});
test('rejects SuperJSON metadata on every dry-run envelope in a batch', () => {
  for (const meta of [
    { values: { _isDryRun: ['undefined'] } },
    null,
    {},
    { values: {} },
  ]) {
    const firstAnnotated = { 0: { ...dry, meta }, 1: dry };
    const secondAnnotated = { 0: dry, 1: { ...dry, meta } };
    assert.equal(
      allowCalRequest('POST', root + 'reserveSlot,reserveSlot?batch=1', JSON.stringify(firstAnnotated)),
      false,
    );
    assert.equal(
      allowCalRequest('POST', root + 'reserveSlot,reserveSlot?batch=1', JSON.stringify(secondAnnotated)),
      false,
    );
  }
});
test('rejects wrong path, origin, malformed JSON and body shape', () => {
  for (const url of [root + 'reserveSlot/other', root + 'reserveSlotEvil', 'https://cal.astforum.ru/api/book/event', root.replace('cal.astforum.ru', 'example.org') + 'reserveSlot']) {
    assert.equal(allowCalRequest('POST', url, JSON.stringify(dry)), false);
  }
  for (const body of ['bad', JSON.stringify([dry]), JSON.stringify({ 1: dry })]) {
    assert.equal(!!allowCalRequest('POST', root + 'reserveSlot?batch=1', body), false);
  }
});
test('rejects additional batch entries and unsupported methods', () => {
  assert.equal(allowCalRequest('POST', root + 'reserveSlot?batch=1', JSON.stringify({ 0: dry, 1: dry })), false);
  assert.equal(allowCalRequest('DELETE', root + 'reserveSlot', JSON.stringify(dry)), false);
  assert.equal(allowCalRequest('GET', root + 'getSlots', null), true);
});
