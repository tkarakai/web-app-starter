// Append-only per-attempt audit records; failure to persist must fail the job.
module.exports = async function recordOps({ github, context, core }) {
  const needs = JSON.parse(process.env.OPS_NEEDS);
  const environment = process.env.OPS_ENVIRONMENT;
  const selectedSha = process.env.OPS_SHA;
  if (!/^[a-f0-9]{40}$/.test(selectedSha)) {
    throw new Error(`Cannot record invalid selected SHA: ${selectedSha}`);
  }
  const failures = [];
  for (const app of ['web', 'admin', 'landing', 'backend']) {
    try {
      const build = needs[`build-${app}`];
      const deploy = needs[app === 'backend' ? 'deploy-convex' : `deploy-${app}`];
      const outputs = build?.outputs || {};
      const deployed = deploy?.outputs || {};
      const unchanged = environment === 'staging' && needs.changes?.result === 'success'
        && needs.changes.outputs[app] === 'false';
      const result = unchanged ? 'unchanged' : deploy?.result || 'unknown';
      const payload = {
        schemaVersion: 1, app, environment, selectedSha,
        builtSha: deployed['built-sha'] || outputs['built-sha'] || null,
        inputHash: outputs['input-hash'] || null,
        artifactId: Number(outputs['artifact-id']) || null,
        artifactName: outputs['artifact-name'] || null,
        checksum: deployed.checksum || null,
        buildRunId: Number(outputs['run-id']) || null,
        reused: outputs.reused === 'true',
        result, buildResult: build?.result || (app === 'backend' ? 'not-applicable' : 'unknown'),
        health: app === 'backend' ? 'workflow-only' : needs[process.env.OPS_HEALTH_JOB]?.outputs?.health || needs[process.env.OPS_HEALTH_JOB]?.result || 'unknown',
        runId: context.runId, runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
        actor: process.env.GITHUB_TRIGGERING_ACTOR || context.actor,
        recordedAt: new Date().toISOString(), deploymentUrl: deployed['deployment-url'] || null,
        requestId: process.env.OPS_REQUEST_ID || null, operation: process.env.OPS_OPERATION,
      };
      const { data: deployment } = await github.rest.repos.createDeployment({
        ...context.repo, ref: selectedSha, task: 'ops-record', environment,
        auto_merge: false, required_contexts: [], production_environment: environment === 'production',
        description: `${app}: ${result} (run ${context.runId}/${payload.runAttempt})`, payload,
      });
      if (!deployment.id) throw new Error(`No deployment record ID returned for ${app}`);
      await github.rest.repos.createDeploymentStatus({
        ...context.repo, deployment_id: deployment.id,
        state: result === 'success' ? 'success' : result === 'unchanged' || result === 'skipped' ? 'inactive' : 'failure',
        auto_inactive: false,
        log_url: `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`,
        ...(payload.deploymentUrl ? { environment_url: payload.deploymentUrl } : {}),
        description: `${app}: ${result}; health: ${payload.health}`,
      });
      core.info(`Recorded ${app}/${environment}: ${result}, record ${deployment.id}`);
    } catch (error) {
      core.error(`Failed to record ${app}/${environment}: ${error.stack || error}`);
      failures.push(app);
    }
  }
  if (failures.length) throw new Error(`Ops records incomplete for: ${failures.join(', ')}`);
};
