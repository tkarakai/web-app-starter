import { assert, type Config, type Run } from './core.ts';
export interface Assignment {
  repository: string; repositoryId: number; runId: number; runAttempt: number;
  sha: string; job?: string; event: string; ref: string; publicBranch?: string;
  pullRequest?: { number: number; head: string; base: string };
}
export function assignment(c: Config, run: Run, sha: string, repositoryId: number, job?: string): Assignment {
  assert(Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0 && Number.isSafeInteger(repositoryId) && repositoryId > 0, 'Missing authenticated assignment identity');
  assert(!c.publicBranch || (run.event === 'workflow_dispatch' && run.head_branch === c.publicBranch), 'Public workers require the reviewed manual branch');
  assert(c.updateRole || job === undefined, 'Ordinary CI cannot receive an updater job');
  const expected: Assignment = { repository: c.repo, repositoryId, runId: run.id, runAttempt: run.run_attempt, sha, job, event: run.event, ref: `refs/heads/${run.head_branch}`, publicBranch: c.publicBranch };
  if (c.updateRole) {
    assert(job && (c.updateRole === 'verify' ? ['check', 'verify'] : ['deliver']).includes(job), 'Updater job is outside installation role');
    assert(c.updateWorkflow && run.path === c.updateWorkflow && ['schedule', 'workflow_dispatch'].includes(run.event) && sha === run.head_sha, 'Unsupported updater workflow, event or source');
  } else if (run.event === 'pull_request') {
    const pr = run.pull_requests[0];
    assert(pr && pr.head.repo.id === repositoryId && pr.base.repo.id === repositoryId && pr.head.sha === run.head_sha, 'PR assignment must belong to this repository and authenticated head');
    expected.ref = `refs/pull/${pr.number}/merge`;
    expected.pullRequest = { number: pr.number, head: pr.head.sha, base: pr.base.sha };
  } else assert(['push', 'workflow_dispatch'].includes(run.event) && sha === run.head_sha, 'Unsupported assignment event or source');
  return expected;
}
