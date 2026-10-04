import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { command, expiredEnvironments, repository, sourceRequest, type Config, type Environment, type Run } from './core.ts';
import { inputs } from './source.ts';
import { runtimePolicy } from './runtime.ts';

const c = { pool: 'pool', cpus: 4, memoryGiB: 8 } as Config;
const sha = 'a'.repeat(40);
const run: Run = { id: 42, head_sha: sha, event: 'workflow_dispatch', head_branch: 'feature', pull_requests: [] };
const job = { id: 1, status: 'queued', labels: ['self-hosted', 'pool', `starter-source-${sha}`, 'starter-run-42'] };
test('repository inference accepts GitHub SSH and HTTPS without executing remote content', () => {
  for (const remote of ['git@github.com:owner/repo.git', 'https://github.com/owner/repo.git', 'ssh://git@github.com/owner/repo']) assert.equal(repository(remote), 'owner/repo');
  for (const remote of ['https://evil.test/owner/repo', 'https://github.com.evil.test/owner/repo', 'https://user:token@github.com/owner/repo', 'git@github.com:../repo']) assert.throws(() => repository(remote));
});
test('routing requires authenticated run, source and explicit public diagnostic policy', () => {
  assert.equal(sourceRequest(c, run, job, 10)?.sha, sha);
  assert.equal(sourceRequest(c, { ...run, id: 41 }, job, 10), undefined);
  assert.equal(sourceRequest(c, { ...run, head_sha: 'b'.repeat(40) }, job, 10), undefined);
  assert.equal(sourceRequest(c, { ...run, event: 'pull_request_target' }, job, 10), undefined);
  assert.equal(sourceRequest({ ...c, publicBranch: 'reviewed' }, run, job, 10), undefined);
  assert(sourceRequest({ ...c, publicBranch: 'feature' }, run, job, 10));
  assert.equal(sourceRequest(c, run, { ...job, labels: [...job.labels, `starter-source-${'b'.repeat(40)}`] }, 10), undefined);
});
test('fork PRs cannot enroll, and PR scope never becomes a branch scope', () => {
  const pr = { number: 7, head: { sha, repo: { id: 10 } }, base: { sha: 'b'.repeat(40), repo: { id: 10 } } };
  assert.equal(sourceRequest(c, { ...run, event: 'pull_request', pull_requests: [pr] }, job, 10)?.scope, 'pr-7');
  assert.equal(sourceRequest(c, { ...run, event: 'pull_request', pull_requests: [{ ...pr, head: { sha, repo: { id: 99 } } }] }, job, 10), undefined);
});
test('collection respects active images and the two newest environments in each branch scope', () => {
  const entry = (image: string, day: number): Environment => ({ image, key: image, tools: 'tool', scope: 'branch-a', source: sha, created: `2026-01-${String(day).padStart(2, '0')}T00:00:00Z`, used: '2026-01-01T00:00:00Z', bytes: 1 });
  const entries = [entry('old', 1), entry('leased', 2), entry('previous', 3), entry('current', 4)];
  assert.deepEqual(expiredEnvironments(entries, new Set(['leased']), Date.parse('2026-02-01')).map(e => e.image), ['old']);
});
test('one canonical runtime specifies no job mounts, capabilities or host network', () => {
  const policy = runtimePolicy(c);
  assert.deepEqual(policy.mounts, []); assert.deepEqual(policy.capabilities, []);
  assert.equal(policy.user, '1001:1001'); assert.equal(policy.noNewPrivileges, true);
  assert.equal(policy.network, 'filtered-proxy-v1');
});
test('source-only commits reuse fingerprint; lockfile and local package bytes invalidate it', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'worker-inputs-'));
  try {
    const git = (...args: string[]): Promise<string> => command('git', ['-C', dir, ...args]);
    await git('init'); await git('config', 'user.name', 'test'); await git('config', 'user.email', 'test@example.invalid');
    await mkdir(path.join(dir, 'packages/local'), { recursive: true });
    const manifest = { packageManager: 'bun@1.4.2', devDependencies: { '@playwright/test': '1.63.0', local: 'file:packages/local' } };
    await writeFile(path.join(dir, 'package.json'), JSON.stringify(manifest));
    await writeFile(path.join(dir, '.node-version'), '24\n');
    await writeFile(path.join(dir, 'bun.lock'), '{"playwright": ["playwright@1.63.0"]}\n');
    await writeFile(path.join(dir, 'packages/local/package.json'), '{"name":"local"}\n');
    await writeFile(path.join(dir, 'packages/local/index.js'), ' export default 1;\n');
    async function snapshot(): Promise<Awaited<ReturnType<typeof inputs>>> { await git('add', '.'); await git('commit', '-m', 'test'); return inputs(dir, await git('rev-parse', 'HEAD')); }
    const first = await snapshot();
    assert.equal(first.files.get('packages/local/index.js'), ' export default 1;\n');
    await writeFile(path.join(dir, 'app.ts'), 'export const x=1');
    assert.equal((await snapshot()).fingerprint, first.fingerprint);
    await writeFile(path.join(dir, 'packages/local/index.js'), 'export default 2;\n');
    const localChanged = await snapshot(); assert.notEqual(localChanged.fingerprint, first.fingerprint);
    await writeFile(path.join(dir, 'bun.lock'), '{"playwright": ["playwright@1.64.0"]}\n');
    const lockChanged = await snapshot(); assert.notEqual(lockChanged.fingerprint, localChanged.fingerprint); assert.equal(lockChanged.playwright, '1.64.0');
    await writeFile(path.join(dir, '.npmrc'), '//npm.example/:_authToken=secret');
    await git('add', '.'); await git('commit', '-m', 'unsafe');
    await assert.rejects(inputs(dir, await git('rev-parse', 'HEAD')), /Custom registry/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
