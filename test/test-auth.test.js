const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isTestAuthEnabled,
  resolveTestAccount,
} = require('../dist/common/constants/test-auth.constants');

function withEnv(patch, fn) {
  const saved = {};
  for (const key of Object.keys(patch)) {
    saved[key] = process.env[key];
    if (patch[key] === undefined) delete process.env[key];
    else process.env[key] = patch[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test('test auth fails closed when NODE_ENV and AUTH_TEST_MODE are unset', () => {
  withEnv({ AUTH_TEST_MODE: undefined, NODE_ENV: undefined }, () => {
    assert.equal(isTestAuthEnabled(), false);
  });
});

test('test auth is off in production unless explicitly enabled', () => {
  withEnv({ NODE_ENV: 'production', AUTH_TEST_MODE: undefined }, () => {
    assert.equal(isTestAuthEnabled(), false);
  });
  withEnv({ NODE_ENV: 'production', AUTH_TEST_MODE: 'true' }, () => {
    assert.equal(isTestAuthEnabled(), true);
  });
});

test('test auth stays on for local development and test runs', () => {
  withEnv({ AUTH_TEST_MODE: undefined, NODE_ENV: 'development' }, () => {
    assert.equal(isTestAuthEnabled(), true);
  });
  withEnv({ AUTH_TEST_MODE: undefined, NODE_ENV: 'test' }, () => {
    assert.equal(isTestAuthEnabled(), true);
  });
});

test('resolveTestAccount accepts slot, local phone, normalized phone and username', () => {
  assert.equal(resolveTestAccount('1').index, 1);
  assert.equal(resolveTestAccount('08000000002').index, 2);
  assert.equal(resolveTestAccount('2348000000002').index, 2);
  assert.equal(resolveTestAccount('test_user_3').index, 3);
  assert.equal(resolveTestAccount('does-not-exist'), undefined);
});
