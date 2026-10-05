import assert from 'node:assert/strict';
import { lstatSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { Assignment } from '../assignment.ts';
export interface EventPayload {
  repository?: { id: number; full_name: string }; number?: number; after?: string; ref?: string;
  pull_request?: { number: number; merge_commit_sha?: string; head?: { sha: string; repo?: { id: number } }; base?: { sha: string; repo?: { id: number } } };
}
export function verifyAssignment(expected: Assignment, context: Record<string, string | undefined>, payload: EventPayload): void {
  assert.match(expected.sha, /^[a-f0-9]{40}$/);
  for (const key of ['repositoryId', 'runId', 'runAttempt'] as const) assert(Number.isSafeInteger(expected[key]) && expected[key] > 0);
  assert.equal(context.GITHUB_REPOSITORY?.toLowerCase(), expected.repository.toLowerCase());
  assert.equal(context.GITHUB_REPOSITORY_ID, String(expected.repositoryId));
  assert.equal(context.GITHUB_RUN_ID, String(expected.runId));
  assert.equal(context.GITHUB_RUN_ATTEMPT, String(expected.runAttempt));
  assert.equal(context.GITHUB_EVENT_NAME, expected.event);
  assert.equal(context.GITHUB_REF, expected.ref);
  assert.equal(payload.repository?.id, expected.repositoryId);
  assert.equal(payload.repository?.full_name?.toLowerCase(), expected.repository.toLowerCase());
  if (expected.publicBranch !== undefined) {
    assert.equal(expected.event, 'workflow_dispatch');
    assert.equal(expected.ref, `refs/heads/${expected.publicBranch}`);
  }
  if (expected.job) {
    assert(['check', 'verify', 'deliver'].includes(expected.job));
    assert.equal(context.GITHUB_JOB, expected.job);
    assert(['schedule', 'workflow_dispatch'].includes(expected.event));
    assert.equal(context.GITHUB_SHA, expected.sha);
  } else if (expected.event === 'pull_request') {
    const pr = expected.pullRequest;
    assert(pr);
    const actual = payload.pull_request;
    assert(actual);
    assert.equal(expected.ref, `refs/pull/${pr.number}/merge`);
    assert.equal(payload.number, pr.number);
    assert.equal(actual.number, pr.number);
    assert.equal(actual.head?.repo?.id, expected.repositoryId);
    assert.equal(actual.base?.repo?.id, expected.repositoryId);
    assert.equal(actual.head?.sha, pr.head);
    assert.equal(actual.base?.sha, pr.base);
    if (expected.sha === pr.head) {
      assert.match(actual.merge_commit_sha ?? '', /^[a-f0-9]{40}$/);
      assert.equal(context.GITHUB_SHA, actual.merge_commit_sha);
    } else {
      // The manager authenticated this merge commit's parents before registration.
      // GitHub can omit or stale the payload's merge_commit_sha on reruns.
      assert.equal(context.GITHUB_SHA, expected.sha);
    }
  } else {
    assert(['push', 'workflow_dispatch'].includes(expected.event));
    assert.equal(context.GITHUB_SHA, expected.sha);
    if (expected.event === 'push') {
      assert.equal(payload.after, expected.sha);
      assert.equal(payload.ref, expected.ref);
    }
  }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  for (const file of ['/opt/starter', '/opt/starter/job-started.sh', '/opt/starter/job-started.ts', '/opt/starter/assignment.json']) {
    const info = lstatSync(file);
    assert.equal(info.uid, 0);
    assert.equal(info.mode & 0o022, 0);
    assert(!info.isSymbolicLink());
    assert(file === '/opt/starter' ? info.isDirectory() : info.isFile());
  }
  const expected = JSON.parse(readFileSync('/opt/starter/assignment.json', 'utf8')) as Assignment;
  assert(process.env.GITHUB_EVENT_PATH);
  const event = lstatSync(process.env.GITHUB_EVENT_PATH);
  assert(event.isFile() && event.size <= 4 * 1024 * 1024);
  verifyAssignment(expected, process.env, JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')));
}
