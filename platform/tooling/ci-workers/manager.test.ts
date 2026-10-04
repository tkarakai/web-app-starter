import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installationPool } from './core.ts';
import { runnerName } from './manager.ts';

test('JIT runner names retain the installation prefix within GitHub limits', () => {
  const pool = installationPool();
  assert.equal(pool.length, 40);
  for (const jobId of [1, 37243842501, Number.MAX_SAFE_INTEGER]) {
    for (const now of [Date.now(), 8_640_000_000_000_000]) {
      const name = runnerName(pool, jobId, now);
      assert(name.startsWith(`${pool}-`), 'registration cleanup requires the full pool prefix');
      assert(name.length <= 64, `GitHub rejects ${name.length}-character runner names`);
      assert.match(name, /^[A-Za-z0-9_-]+$/);
    }
  }
  assert(runnerName(pool, 37243842501).length <= 64);
});

test('JIT runner names distinguish jobs, registration times and installations', () => {
  const pool = installationPool(), now = Date.now();
  const names = [
    runnerName(pool, 37243842501, now),
    runnerName(pool, 37243842502, now),
    runnerName(pool, 37243842501, now + 1),
    runnerName(pool, Number.MAX_SAFE_INTEGER, now),
    runnerName(pool, Number.MAX_SAFE_INTEGER - 1, now),
    runnerName(installationPool(), 37243842501, now),
  ];
  assert.equal(new Set(names).size, names.length);
});
