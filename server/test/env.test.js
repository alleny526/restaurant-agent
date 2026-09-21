import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEnv } from '../src/env.js';

test('environment parser handles comments, whitespace, quotes and embedded equals signs', () => {
  assert.deepEqual(parseEnv(`
    # local configuration
    PORT=8787
    AUTH_SECRET="random=value"
    HUAWEI_CLIENT_ID='123456'
    invalid line
  `), {
    PORT: '8787',
    AUTH_SECRET: 'random=value',
    HUAWEI_CLIENT_ID: '123456'
  });
});
