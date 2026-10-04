import path from 'node:path';
import { assert, catalog, hash, home, readJson, type Config } from './core.ts';
import { runtimePolicy } from './runtime.ts';
export interface Proof { id: string; sha: string; image: string; runtime: string; key: string; scope: string; pool: string; checked: string; }
export function proofId(proof: Pick<Proof, 'sha' | 'image' | 'runtime' | 'pool' | 'checked'>): string { return hash(JSON.stringify([proof.sha, proof.image, proof.runtime, proof.pool, proof.checked])); }
export async function localProof(c: Config): Promise<Proof> {
  const proof = await readJson<Proof>(path.join(home, 'local-check.json'));
  const age = Date.now() - Date.parse(proof.checked);
  assert(age >= 0 && age < 86400_000 && proof.id === proofId(proof) && /^[a-f0-9]{40}$/.test(proof.sha) && /^sha256:[a-f0-9]{64}$/.test(proof.image) && proof.pool === c.pool && proof.runtime === hash(JSON.stringify(runtimePolicy(c))), 'A fresh local check with the current runtime policy is required');
  const state = await catalog();
  const environment = state.environments.find(e => e.key === proof.key && e.scope === proof.scope && e.source === proof.sha);
  assert(environment?.image === proof.image && state.environments.filter(e => e.scope === proof.scope && e.source === proof.sha).sort((a, b) => b.used.localeCompare(a.used))[0]?.image === proof.image, 'Prepared environment changed; repeat the local check');
  return proof;
}
export function certify(proof: Proof, run: { display_title: string; head_sha: string }): void {
  assert(run.head_sha === proof.sha && run.display_title === `Worker check ${proof.id}`, 'GitHub run does not belong to this local proof');
}
