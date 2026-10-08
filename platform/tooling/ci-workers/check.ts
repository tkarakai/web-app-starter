import { validateRepo } from './core.ts';

// Only the archive inside the disposable worker is indexed; host Git state is untouched.
export function sourceCheck(mode: 'install' | 'quick' | 'ci', repository = process.env.PLATFORM_SOURCE_REPOSITORY || 'tkarakai/web-app-starter'): string[] {
  if (mode === 'install') return ['exec', '/bin/bash', '-c', 'bun install --offline --frozen-lockfile'];
  validateRepo(repository);
  const script = [
    'git -c core.hooksPath=/dev/null init --quiet',
    'git -c core.hooksPath=/dev/null add --force --all',
    'git -c core.hooksPath=/dev/null -c commit.gpgsign=false -c user.name=starter-worker -c user.email=worker@localhost commit --quiet -m "Exact-source worker snapshot"',
    'node platform/tooling/ci-workers/baseline.ts',
    'bun install --offline --frozen-lockfile',
    mode === 'ci' ? 'bun run ci' : 'bun run ci:quick',
  ].join(' && ');
  return ['exec', '/usr/bin/env', `PLATFORM_SOURCE_REPOSITORY=${repository}`, '/bin/bash', '-c', script];
}
