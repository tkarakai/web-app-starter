import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignment } from './assignment.ts';
import { verifyAssignment, type EventPayload } from './recipe/job-started.ts';
import type { Config, Run } from './core.ts';

const c = { repo: 'owner/repo' } as Config;
const head = 'a'.repeat(40), merge = 'b'.repeat(40), base = 'c'.repeat(40);
const run: Run = { id: 123, run_attempt: 2, head_sha: head, head_branch: 'main', event: 'push', pull_requests: [] };
const context = { GITHUB_REPOSITORY: c.repo, GITHUB_REPOSITORY_ID: '7', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: head };
const payload: EventPayload = { repository: { id: 7, full_name: c.repo }, ref: 'refs/heads/main', after: head };

test('approved push/dispatch assignments pass and copied labels cannot authorize mismatched contexts', () => {
  const expected = assignment(c, run, head, 7);
  verifyAssignment(expected, context, payload);
  for (const key of Object.keys(context)) assert.throws(() => verifyAssignment(expected, { ...context, [key]: 'wrong' }, payload), key);
  for (const repository of [{ id: 8, full_name: c.repo }, { id: 7, full_name: 'other/repo' }]) assert.throws(() => verifyAssignment(expected, context, { ...payload, repository }));
  assert.throws(() => verifyAssignment(expected, context, { ...payload, after: merge }));
  assert.throws(() => verifyAssignment(expected, context, { ...payload, ref: 'refs/heads/other' }));
  const manual = assignment({ ...c, publicBranch: 'main' }, { ...run, event: 'workflow_dispatch' }, head, 7);
  verifyAssignment(manual, { ...context, GITHUB_EVENT_NAME: 'workflow_dispatch' }, { repository: payload.repository });
  assert.throws(() => assignment({ ...c, publicBranch: 'other' }, { ...run, event: 'workflow_dispatch' }, head, 7));
  assert.throws(() => assignment({ ...c, publicBranch: 'main' }, run, head, 7));
  assert.throws(() => verifyAssignment({ ...manual, publicBranch: 'other' }, { ...context, GITHUB_EVENT_NAME: 'workflow_dispatch' }, payload));
  assert.throws(() => assignment(c, { ...run, event: 'pull_request_target' }, head, 7));
  assert.throws(() => assignment(c, { ...run, run_attempt: 0 }, head, 7));
});

test('PR assignment validates merge context separately from the authenticated run head and rejects forks', () => {
  const prRun: Run = { ...run, event: 'pull_request', pull_requests: [{ number: 42, head: { sha: head, repo: { id: 7 } }, base: { sha: base, repo: { id: 7 } } }] };
  const prContext = { ...context, GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/pull/42/merge', GITHUB_SHA: merge };
  const prPayload: EventPayload = { repository: payload.repository, number: 42, pull_request: { number: 42, head: { sha: head, repo: { id: 7 } }, base: { sha: base, repo: { id: 7 } }, merge_commit_sha: merge } };
  for (const source of [head, merge]) verifyAssignment(assignment(c, prRun, source, 7), prContext, prPayload);
  const expected = assignment(c, prRun, merge, 7);
  assert.throws(() => verifyAssignment(expected, { ...prContext, GITHUB_SHA: head }, prPayload));
  assert.throws(() => verifyAssignment(expected, prContext, { ...prPayload, number: 43 }));
  for (const key of ['head', 'base'] as const) {
    for (const changed of [{ sha: merge, repo: { id: 7 } }, { sha: key === 'head' ? head : base, repo: { id: 8 } }]) {
      assert.throws(() => verifyAssignment(expected, prContext, { ...prPayload, pull_request: { ...prPayload.pull_request!, [key]: changed } }));
    }
  }
  assert.throws(() => assignment(c, { ...prRun, pull_requests: [{ ...prRun.pull_requests[0], head: { sha: head, repo: { id: 8 } } }] }, merge, 7));
  assert.throws(() => assignment(c, { ...prRun, head_sha: merge }, merge, 7));
});


test('repository casing is independent in configuration, runner context and payload while IDs remain exact', () => {
  for (const repository of ['owner/repo', 'Owner/Repo', 'OWNER/REPO']) {
    const expected = assignment({ ...c, repo: repository }, run, head, 7);
    for (const actual of ['owner/repo', 'oWnEr/rEpO']) {
      for (const full_name of ['owner/repo', 'OWNER/Repo']) {
        const actualContext = { ...context, GITHUB_REPOSITORY: actual };
        const actualPayload = { ...payload, repository: { id: 7, full_name } };
        verifyAssignment(expected, actualContext, actualPayload);
        assert.throws(() => verifyAssignment(expected, { ...actualContext, GITHUB_REPOSITORY_ID: '8' }, actualPayload));
        assert.throws(() => verifyAssignment(expected, actualContext, { ...actualPayload, repository: { id: 8, full_name } }));
      }
    }
  }
});

test('updater roles bind scheduled/manual jobs to repository, run, attempt, source and job', () => {
  for (const event of ['schedule', 'workflow_dispatch']) {
    for (const [role, jobs] of [['verify', ['check', 'verify']], ['deliver', ['deliver']]] as const) {
      const config = { ...c, updateRole: role, updateWorkflow: '.github/workflows/update.yml' };
      const updater = { ...run, event, path: config.updateWorkflow };
      for (const job of jobs) {
        const expected = assignment(config, updater, head, 7, job);
        const actual = { ...context, GITHUB_EVENT_NAME: event, GITHUB_JOB: job };
        verifyAssignment(expected, actual, { repository: payload.repository });
        for (const key of Object.keys(actual)) assert.throws(() => verifyAssignment(expected, { ...actual, [key]: 'wrong' }, { repository: payload.repository }), key);
      }
      assert.throws(() => assignment(config, updater, merge, 7, jobs[0]));
      assert.throws(() => assignment(config, { ...updater, path: '.github/workflows/ci.yml' }, head, 7, jobs[0]));
      assert.throws(() => assignment(config, { ...updater, event: 'pull_request' }, head, 7, jobs[0]));
      assert.throws(() => assignment(config, updater, head, 7, role === 'verify' ? 'deliver' : 'verify'));
      assert.throws(() => assignment({ ...config, publicBranch: 'main' }, { ...updater, event: 'schedule' }, head, 7, jobs[0]));
    }
  }
  assert.throws(() => assignment(c, run, head, 7, 'deliver'));
});

test('manual updater diagnostics use the same assignment checks without admitting other workflows or schedules', () => {
  for (const [role, job] of [['verify', 'check'], ['verify', 'verify'], ['deliver', 'deliver']] as const) {
    const config = { ...c, updateRole: role, updateWorkflow: '.github/workflows/update-platform.yml' };
    const diagnostic = { ...run, path: '.github/workflows/platform-update-workers-check.yml', event: 'workflow_dispatch' };
    const expected = assignment(config, diagnostic, head, 7, job);
    verifyAssignment(expected, { ...context, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_JOB: job }, { repository: payload.repository });
    assert.throws(() => assignment(config, { ...diagnostic, event: 'schedule' }, head, 7, job));
    assert.throws(() => assignment(config, { ...diagnostic, path: '.github/workflows/other.yml' }, head, 7, job));
  }
});
