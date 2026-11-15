import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installationPool } from './core.ts';
import { api, GitHubError, listPages, rateLimitRetryAt, responseCacheLimit, responseCacheSize } from './github.ts';
import { Deferrals, failureDelay, noticeTruncation, register, Registrations, retryDelay, runJobs, runnerName, schedulableRuns } from './manager.ts';

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

type Route = (endpoint: string, method: string) => Response | Promise<Response>;
async function withGitHub<T>(route: Route, action: (calls: string[]) => Promise<T>): Promise<T> {
  const original = globalThis.fetch, write = process.stderr.write;
  const calls: string[] = [];
  globalThis.fetch = (async (url: string, init?: Parameters<typeof fetch>[1]) => {
    const endpoint = String(url).slice('https://api.github.com'.length), method = init?.method ?? 'GET';
    calls.push(`${method} ${endpoint}`);
    return route(endpoint, method);
  }) as typeof fetch;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  try { return await action(calls); } finally { globalThis.fetch = original; process.stderr.write = write; }
}
const page = (key: string, start: number, count: number): Response => Response.json({ [key]: Array.from({ length: count }, (_, n) => ({ id: start + n })) });

test('list pagination reads until a short page and reports truncation', async () => {
  await withGitHub(endpoint => {
    const number = Number(new URL(endpoint, 'https://x').searchParams.get('page'));
    return page('runners', number * 100, number < 3 ? 100 : 7);
  }, async calls => {
    const all = await listPages<{ id: number }>('/repos/o/r/actions/runners', 'runners', 'credential', 10);
    assert.deepEqual([all.items.length, all.complete], [207, true]);
    assert.equal(calls.length, 3);
    const capped = await listPages<{ id: number }>('/repos/o/r/actions/runners?status=queued', 'runners', 'credential', 2);
    assert.deepEqual([capped.items.length, capped.complete], [200, false]);
    assert.match(calls.at(-1)!, /\?status=queued&per_page=100&page=2$/);
  });
});

test('registration sweeps remove only idle registrations owned by this installation and retry failed removals', async () => {
  const pool = 'starter-' + 'a'.repeat(32);
  const removed: number[] = [];
  let failing = true;
  await withGitHub((endpoint, method) => {
    if (method === 'GET') return Response.json({ runners: [
      { id: 1, name: `${pool}-1-x` }, { id: 2, name: `${pool}-2-x` }, { id: 3, name: `starter-${'b'.repeat(32)}-3-x` }, { id: 4, name: 'someone-else' }, { id: 5, name: `${pool}-5-x` },
    ] });
    const id = Number(endpoint.split('/').at(-1));
    if (id === 2 && failing) return new Response('unavailable', { status: 502 });
    if (id === 5) return new Response('gone', { status: 404 });
    removed.push(id);
    return new Response(null, { status: 204 });
  }, async () => {
    const registrations = new Registrations('/repos/o/r', pool);
    registrations.active.add(1);
    await registrations.sweep('credential');
    assert.deepEqual(removed, [], 'active, foreign and already-deleted registrations are kept or skipped');
    assert.deepEqual(registrations.pending, [2]);
    await registrations.retry('credential');
    assert.deepEqual(registrations.pending, [2], 'a failing removal stays pending');
    failing = false;
    await registrations.retry('credential');
    assert.deepEqual([removed, registrations.pending], [[2], []]);
  });
});

test('a lost JIT registration response sweeps owned idle registrations; a definite rejection does not', async () => {
  const pool = 'starter-' + 'c'.repeat(32);
  for (const [failure, sweeps] of [[() => { throw new TypeError('fetch failed'); }, true], [() => new Response('server', { status: 500 }), true], [() => new Response('invalid', { status: 422 }), false]] as const) {
    await withGitHub((endpoint, method) => {
      if (endpoint.endsWith('/generate-jitconfig')) return failure();
      if (method === 'GET') return Response.json({ runners: [{ id: 9, name: `${pool}-9-x` }] });
      return new Response(null, { status: 204 });
    }, async calls => {
      const registrations = new Registrations('/orgs/o', pool);
      await assert.rejects(register(registrations, 'credential', '/orgs/o/actions/runners/generate-jitconfig', { name: `${pool}-9-x` }));
      assert.equal(calls.includes('DELETE /orgs/o/actions/runners/9'), sweeps);
      assert.equal(registrations.active.size, 0);
    });
  }
  await withGitHub(() => Response.json({ encoded_jit_config: 'config', runner: { id: 11 } }), async () => {
    const registrations = new Registrations('/orgs/o', pool);
    await register(registrations, 'credential', '/orgs/o/actions/runners/generate-jitconfig', {});
    assert.deepEqual([...registrations.active], [11], 'a running worker\'s registration is protected from sweeps');
  });
});

test('schedulable runs are deduplicated, oldest first, and a truncated backlog is reported once', async () => {
  const run = (id: number) => ({ id, run_attempt: 1, head_sha: 'a'.repeat(40), head_branch: 'main', event: 'push', pull_requests: [] });
  let queued = 2;
  await withGitHub(endpoint => {
    const url = new URL(endpoint, 'https://x');
    if (url.searchParams.get('status') === 'queued') return Response.json({ workflow_runs: Array.from({ length: queued === 2 ? 2 : 100 }, (_, n) => run(queued === 2 ? [30, 10][n] : 1000 - n)) });
    if (url.searchParams.get('status') === 'in_progress') return Response.json({ workflow_runs: [run(20), run(10)] });
    return Response.json({ jobs: [{ id: 1, status: 'queued', labels: [] }] });
  }, async () => {
    const notices = new Set<string>();
    assert.deepEqual((await schedulableRuns('o/r', 'credential', notices)).map(r => r.id), [10, 20, 30]);
    assert.equal(notices.size, 0);
    queued = 500;
    await schedulableRuns('o/r', 'credential', notices);
    assert.deepEqual([...notices], ['runs o/r']);
    assert.equal((await runJobs('o/r', 1, 'credential', notices)).length, 1);
  });
  const notices = new Set<string>();
  const lines: string[] = [];
  const write = process.stderr.write;
  process.stderr.write = ((line: string) => { lines.push(line); return true; }) as typeof process.stderr.write;
  try {
    for (const complete of [false, false, true, false]) noticeTruncation(notices, 'key', complete, 'truncated');
  } finally { process.stderr.write = write; }
  assert.equal(lines.length, 2, 'reported when truncation starts and again only after it cleared');
});
