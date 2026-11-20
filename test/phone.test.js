const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeNgPhone } = require('../dist/common/utils/phone.util');

test('normalizes local Nigerian numbers to 234 digits', () => {
  assert.equal(normalizeNgPhone('08012345678'), '2348012345678');
  assert.equal(normalizeNgPhone('08000000001'), '2348000000001');
});

test('keeps already-normalized numbers stable', () => {
  assert.equal(normalizeNgPhone('2348012345678'), '2348012345678');
  assert.equal(normalizeNgPhone('+234 801 234 5678'), '2348012345678');
});

test('strips formatting characters', () => {
  assert.equal(normalizeNgPhone('0801-234-5678'), '2348012345678');
});
