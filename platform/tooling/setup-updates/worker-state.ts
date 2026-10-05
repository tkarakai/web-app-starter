import type { Gh } from './github.ts';

export type WorkerChoice = 'hosted' | 'local';
export const WORKER_VARIABLES = { verify: 'PLATFORM_UPDATE_RUNNER', deliver: 'PLATFORM_UPDATE_DELIVERY_RUNNER' } as const;
export type WorkerRecord = {
  choice: WorkerChoice; status: 'pending' | 'configured';
  pools?: { verify: string; deliver: string };
  test?: { runId: number; sha: string; proof: string; checkedAt: string };
  homes?: { verify: string; deliver: string };
  ownerActions: string[];
};
export type WorkerStatus = {
  choice: WorkerChoice | 'mixed' | 'unknown'; pools: { verify: string; deliver: string } | null;
  readiness: 'ready' | 'blocked' | 'unknown'; lastTest: WorkerRecord['test'] | null;
  availability: 'unknown'; ownerActions: string[];
};
export function workerCommand(repo: string, choice: WorkerChoice, homes?: WorkerRecord['homes'], runId?: string): string {
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  return 'bun run platform:setup-updates --repo ' + quote(repo) + ' --workers ' + choice + (runId ? ' --worker-run ' + runId : '') + (homes ? ' --verify-home ' + quote(homes.verify) + ' --deliver-home ' + quote(homes.deliver) : '') + ' --yes';
}
export function workerVariables(repo: string, run: Gh): { verify: string; deliver: string } {
  const rows = JSON.parse(run(['variable', 'list', '--repo', repo, '--json', 'name,value'])) as { name: string; value: string }[];
  return { verify: rows.find(r => r.name === WORKER_VARIABLES.verify)?.value ?? '', deliver: rows.find(r => r.name === WORKER_VARIABLES.deliver)?.value ?? '' };
}
export function workerStatus(repo: string | undefined, intent: WorkerRecord | undefined, run: Gh): WorkerStatus {
  const result: WorkerStatus = { choice: 'unknown', pools: null, readiness: 'unknown', lastTest: intent?.test ?? null, availability: 'unknown', ownerActions: [...(intent?.ownerActions ?? [])] };
  if (!repo) return result;
  try {
    const pools = workerVariables(repo, run); result.pools = pools;
    result.choice = !pools.verify && !pools.deliver ? 'hosted' : pools.verify && pools.deliver ? 'local' : 'mixed';
    if (intent && (intent.choice !== result.choice || intent.status !== 'configured')) {
      result.readiness = 'blocked'; if (!intent.ownerActions.length) result.ownerActions.push('Finish the recorded worker choice with ' + workerCommand(repo, intent.choice, intent.homes) + '.');
    } else if (result.choice === 'hosted') result.readiness = 'ready';
    else if (intent?.test && intent.pools?.verify === pools.verify && intent.pools.deliver === pools.deliver) {
      const test = JSON.parse(run(['api', 'repos/' + repo + '/actions/runs/' + intent.test.runId]));
      if (test.status === 'completed' && test.conclusion === 'success' && test.event === 'workflow_dispatch' && test.path === '.github/workflows/platform-update-workers-check.yml' && test.head_sha === intent.test.sha && test.display_title === 'Updater worker check ' + intent.test.proof) result.readiness = 'ready';
      else { result.readiness = 'blocked'; result.ownerActions.push('The recorded worker test no longer confirms success; repeat ' + workerCommand(repo, 'local', intent.homes) + '.'); }
    } else result.ownerActions.push('Existing worker routing is preserved but has no matching setup test. Run ' + workerCommand(repo, 'local', intent?.homes) + ' to validate it.');
    if (result.choice !== 'hosted') result.ownerActions.push('Keep the worker host and Docker available. Last test success does not establish current host availability; inspect each worker service status.');
  } catch { result.ownerActions.push('Worker routing or test status could not be read. Sign in with gh and rerun --check.'); }
  return result;
}
