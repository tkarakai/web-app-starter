import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertOrgAccess } from './github.ts';
import { configuredRepos, preparedScope, selectedRepo, sourceRequest, type Config, type Run, type Job } from './core.ts';
import { assignment } from './assignment.ts';

const sha = 'a'.repeat(40);
const base = { org: 'team', repo: 'team/alpha', repos: ['team/alpha', 'team/beta'], runnerGroupId: 7, pool: 'starter-pool' } as Config;
test('organization members retain separate source scopes and authenticated assignments', () => {
  assert.deepEqual(configuredRepos(base), ['team/alpha', 'team/beta']);
  const alpha = selectedRepo(base, 'TEAM/ALPHA');
  const beta = selectedRepo(base, 'team/beta');
  assert.notEqual(preparedScope(alpha, 'branch-main'), preparedScope(beta, 'branch-main'));
  assert.throws(() => selectedRepo(base, 'team/other'), /not configured/);
  const run: Run = { id: 42, run_attempt: 1, head_sha: sha, head_branch: 'main', event: 'push', pull_requests: [] };
  const job: Job = { id: 4, status: 'queued', labels: ['self-hosted', base.pool, `starter-source-${sha}`, 'starter-run-42'] };
  const request = sourceRequest(beta, run, job, 22);
  assert(request);
  assert.equal(assignment(beta, run, request.sha, 22).repository, 'team/beta');
  assert.equal(sourceRequest(beta, { ...run, id: 43 }, job, 22), undefined);
});

test('organization group must be private, selected, and include the repository ID', async () => {
  const original = globalThis.fetch;
  let visibility = 'selected', allowsPublic = false, selectedId = 22, privateRepo = true;
  globalThis.fetch = async (input) => {
    const url = String(input);
    const body = url.endsWith('/repos/team/beta') ? { id: 22, private: privateRepo }
      : url.endsWith('/orgs/team/actions/runner-groups/7') ? { id: 7, visibility, allows_public_repositories: allowsPublic }
      : url.includes('/orgs/team/actions/runner-groups/7/repositories?') ? { repositories: [{ id: selectedId }] }
      : undefined;
    assert(body, `Unexpected GitHub endpoint ${url}`);
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    assert.equal(await assertOrgAccess(base, 'credential', 'team/beta'), 22);
    visibility = 'all'; await assert.rejects(assertOrgAccess(base, 'credential', 'team/beta'), /selected-repository/);
    visibility = 'selected'; allowsPublic = true; await assert.rejects(assertOrgAccess(base, 'credential', 'team/beta'), /selected-repository/);
    allowsPublic = false; selectedId = 99; await assert.rejects(assertOrgAccess(base, 'credential', 'team/beta'), /does not grant access/);
    selectedId = 22; privateRepo = false; await assert.rejects(assertOrgAccess(base, 'credential', 'team/beta'), /private repositories/);
    await assert.rejects(assertOrgAccess(base, 'credential', 'outsider/beta'), /configured organization/);
  } finally { globalThis.fetch = original; }
});
