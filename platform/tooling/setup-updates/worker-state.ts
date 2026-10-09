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
  choice: WorkerChoice | 'auxiliary' | 'unconfigured' | 'mixed' | 'unknown'; pools: { verify: string; deliver: string } | null;
  visibility: 'public' | 'private' | 'unknown';
  routes: { verify: WorkerRoute; deliver: WorkerRoute };
  routingScope: 'repository-only'; limitations: string[];
  readiness: 'ready' | 'blocked' | 'unknown'; lastTest: WorkerRecord['test'] | null;
  availability: 'unknown'; ownerActions: string[];
};
export type WorkerRoute = { kind: 'hosted' | 'prepared' | 'auxiliary' | 'unconfigured' | 'unknown'; label?: string };
export function workerCommand(repo: string, choice: WorkerChoice, homes?: WorkerRecord['homes'], runId?: string): string {
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  return 'bun run platform:setup-updates --repo ' + quote(repo) + ' --workers ' + choice + (runId ? ' --worker-run ' + runId : '') + (homes ? ' --verify-home ' + quote(homes.verify) + ' --deliver-home ' + quote(homes.deliver) : '') + ' --yes';
}
export function workerVariables(repo: string, run: Gh): { verify: string; deliver: string } {
  return poolsFrom(repositoryVariables(repo, run));
}
function repositoryVariables(repo: string, run: Gh): Map<string, string> {
  const rows = JSON.parse(run(['variable', 'list', '--repo', repo, '--json', 'name,value'])) as { name: string; value: string }[];
  return new Map(rows.map(row => [row.name, row.value]));
}
function poolsFrom(variables: Map<string, string>): { verify: string; deliver: string } {
  return { verify: variables.get(WORKER_VARIABLES.verify) ?? '', deliver: variables.get(WORKER_VARIABLES.deliver) ?? '' };
}
export function workerStatus(repo: string | undefined, intent: WorkerRecord | undefined, run: Gh): WorkerStatus {
  const result: WorkerStatus = { choice: 'unknown', pools: null, visibility: 'unknown', routes: { verify: { kind: 'unknown' }, deliver: { kind: 'unknown' } }, routingScope: 'repository-only', limitations: ['Routing uses repository-level variables only. Organization/environment overrides and customized workflows are not inspected; confirm effective labels in an actual workflow run.'], readiness: 'unknown', lastTest: intent?.test ?? null, availability: 'unknown', ownerActions: [...(intent?.ownerActions ?? [])] };
  if (!repo) return result;
  try {
    const variables = repositoryVariables(repo, run), pools = poolsFrom(variables); result.pools = pools;
    const repository = JSON.parse(run(['api', 'repos/' + repo])) as { private?: boolean };
    if (repository.private !== true && repository.private !== false) {
      result.ownerActions.push('Cannot confirm repository visibility; effective worker routing and readiness are unknown.');
      return result;
    }
    result.visibility = repository.private ? 'private' : 'public';
    const local = variables.get('PLATFORM_CI_LOCAL_ONLY')?.toLowerCase() === 'true' || ['PLATFORM_CI_WORKER_POOL', 'PLATFORM_CI_AUX_RUNNER', 'PLATFORM_CI_RUNNER', ...Object.values(WORKER_VARIABLES)].some(name => Boolean(variables.get(name)));
    const auxiliary = variables.get('PLATFORM_CI_AUX_RUNNER') || variables.get('PLATFORM_CI_RUNNER');
    const route = (pool: string): WorkerRoute => {
      if (!repository.private) return { kind: 'hosted', label: 'ubuntu-latest' };
      if (pool) return { kind: 'prepared', label: pool };
      if (!local) return { kind: 'hosted', label: 'ubuntu-latest' };
      return auxiliary ? { kind: 'auxiliary', label: auxiliary } : { kind: 'unconfigured', label: 'starter-local-only-unconfigured' };
    };
    result.routes = { verify: route(pools.verify), deliver: route(pools.deliver) };
    const routes = Object.values(result.routes);
    result.choice = routes[0].kind !== routes[1].kind ? 'mixed' : routes[0].kind === 'prepared' ? 'local' : routes[0].kind;
    if (!repository.private && (local || intent?.choice === 'local')) {
      result.readiness = 'blocked';
      result.ownerActions.push('Public repositories always use GitHub-hosted runners. Retire local installations and review all six local selectors at repository, organization and environment scope; historical local tests cannot certify public workers. Clear updater pool overrides with ' + workerCommand(repo, 'hosted') + '; that command preserves other selectors.');
      return result;
    }
    if (routes.some(value => value.kind === 'unconfigured')) {
      result.readiness = 'blocked';
      result.ownerActions.push('Updater jobs have an unconfigured local route. Provide a trusted PLATFORM_CI_AUX_RUNNER for uncovered roles, or explicitly remove all six local selectors for fully hosted execution; clearing only updater pools does not restore hosted execution.');
      return result;
    }
    // Intent controls the prepared-pool choice; it does not certify an auxiliary runner.
    const poolChoice = !pools.verify && !pools.deliver ? 'hosted' : pools.verify && pools.deliver ? 'local' : 'mixed';
    if (intent && (intent.choice !== poolChoice || intent.status !== 'configured')) {
      result.readiness = 'blocked';
      if (!intent.ownerActions.length) result.ownerActions.push('Finish the recorded worker choice with ' + workerCommand(repo, intent.choice, intent.homes) + '.');
    } else if (result.choice === 'hosted') result.readiness = 'ready';
    else if (routes.some(value => value.kind === 'auxiliary')) {
      result.ownerActions.push('Updater jobs use an auxiliary self-hosted runner. Its tools, trust and availability are not certified by prepared-pool tests; inspect that runner and an actual updater run.');
    } else if (intent?.test && intent.pools?.verify === pools.verify && intent.pools.deliver === pools.deliver) {
      const test = JSON.parse(run(['api', 'repos/' + repo + '/actions/runs/' + intent.test.runId]));
      if (test.status === 'completed' && test.conclusion === 'success' && test.event === 'workflow_dispatch' && test.path === '.github/workflows/platform-update-workers-check.yml' && test.head_sha === intent.test.sha && test.display_title === 'Updater worker check ' + intent.test.proof) result.readiness = 'ready';
      else {
        result.readiness = 'blocked'; result.ownerActions.push('The recorded worker test no longer confirms success; repeat ' + workerCommand(repo, 'local', intent.homes) + '.');
      }
    } else result.ownerActions.push('Existing worker routing is preserved but has no matching setup test. Run ' + workerCommand(repo, 'local', intent?.homes) + ' to validate it.');
    if (result.choice !== 'hosted') result.ownerActions.push('Keep the worker host and Docker available. Last test success does not establish current host availability; inspect each worker service status.');
  } catch { result.ownerActions.push('Worker routing or test status could not be read. Sign in with gh and rerun --check.'); }
  return result;
}
