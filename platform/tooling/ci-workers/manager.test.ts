import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installationPool } from './core.ts';
import { api, GitHubError, rateLimitRetryAt, responseCacheLimit, responseCacheSize } from './github.ts';
import { Deferrals, failureDelay, retryDelay, runnerName } from './manager.ts';

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

test('failure backoff doubles from its base and stops at its ceiling', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 100].map(n => failureDelay(n, 15_000, 600_000)), [15_000, 15_000, 30_000, 60_000, 120_000, 240_000, 480_000, 600_000, 600_000]);
});

test('retry delay waits for a GitHub rate-limit reset within its ceiling', () => {
  const now = 1_000_000;
  assert.equal(retryDelay(new Error('docker failed'), 30_000, 3600_000, now), 30_000);
  assert.equal(retryDelay(new GitHubError('limited', 403, now + 20 * 60_000), 30_000, 3600_000, now), 20 * 60_000 + 1000);
  assert.equal(retryDelay(new GitHubError('limited', 403, now + 5000), 30_000, 3600_000, now), 30_000);
  assert.equal(retryDelay(new GitHubError('limited', 403, now + 5 * 3600_000), 30_000, 3600_000, now), 3600_000);
  assert.equal(retryDelay(new GitHubError('forbidden', 403), 30_000, 3600_000, now), 30_000);
});

test('rate-limit responses expose their retry time; other failures do not', () => {
  const now = 1_794_669_052_000;
  const headers = (values: Record<string, string>): Headers => new Headers(values);
  const exhausted = headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1794671103' });
  assert.equal(rateLimitRetryAt(403, exhausted, now), 1_794_671_103_000);
  assert.equal(rateLimitRetryAt(429, exhausted, now), 1_794_671_103_000);
  assert.equal(rateLimitRetryAt(403, headers({ 'retry-after': '90', 'x-ratelimit-remaining': '12' }), now), now + 90_000);
  assert.equal(rateLimitRetryAt(429, headers({}), now), now + 60_000);
  assert.equal(rateLimitRetryAt(403, headers({ 'x-ratelimit-remaining': '42', 'x-ratelimit-reset': '1794671103' }), now), undefined);
  assert.equal(rateLimitRetryAt(404, exhausted, now), undefined);
  assert.equal(rateLimitRetryAt(403, headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1' }), now), now);
});

test('conditional-request cache keeps a bounded number of recently used responses', async () => {
  const original = globalThis.fetch;
  const requests: { url: string; etag: string | null }[] = [];
  globalThis.fetch = (async (url: string, init?: Parameters<typeof fetch>[1]) => {
    const etag = new Headers(init?.headers).get('if-none-match');
    requests.push({ url: String(url), etag });
    return etag ? new Response(null, { status: 304 }) : Response.json({ url: String(url) }, { headers: { etag: `"${String(url)}"` } });
  }) as typeof fetch;
  try {
    for (let n = 0; n < responseCacheLimit + 50; n++) await api(`/repos/owner/repo/actions/jobs/${n}`, 'credential');
    assert.equal(responseCacheSize(), responseCacheLimit);
    assert.deepEqual(await api(`/repos/owner/repo/actions/jobs/${responseCacheLimit + 49}`, 'credential'), { url: `https://api.github.com/repos/owner/repo/actions/jobs/${responseCacheLimit + 49}` });
    assert.notEqual(requests.at(-1)!.etag, null, 'recent entries still send If-None-Match');
    await api('/repos/owner/repo/actions/jobs/0', 'credential');
    assert.equal(requests.at(-1)!.etag, null, 'evicted entries are fetched again without a stale ETag');
  } finally { globalThis.fetch = original; }
});

test('per-item deferrals back off independently and leave shared failures to the manager', () => {
  const deferrals = new Deferrals(), now = 1_000_000;
  const write = process.stderr.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  try {
    deferrals.failed('job 1', new Error('lockfile rejected'), now);
    assert.equal(deferrals.ready('job 1', now + 59_999), false);
    assert.equal(deferrals.ready('job 2', now), true, 'other jobs remain admissible');
    assert.equal(deferrals.ready('job 1', now + 60_000), true);
    deferrals.failed('job 1', new Error('lockfile rejected'), now + 60_000);
    assert.equal(deferrals.ready('job 1', now + 60_000 + 119_999), false);
    deferrals.succeeded('job 1');
    assert.equal(deferrals.ready('job 1', now + 60_000), true);
    assert.throws(() => deferrals.failed('job 3', new GitHubError('limited', 403, now + 1000), now), /limited/);
    assert.throws(() => deferrals.failed('job 3', new GitHubError('bad credentials', 401), now), /bad credentials/);
    assert.equal(deferrals.ready('job 3', now), true, 'shared failures are not attributed to one job');
  } finally { process.stderr.write = write; }
});
