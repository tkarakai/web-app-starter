// Shared policy: a never-configured app skips automatic deployment. Broken or explicitly
// requested deployments fail. Log names only, never credentials.
function readiness(env) {
  const landing = env.LANDING_APP === 'landing-static' ? 'LANDING_STATIC' : 'LANDING';
  const required = ['VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID_WEB_STAGING',
    'VERCEL_PROJECT_ID_ADMIN_STAGING', `VERCEL_PROJECT_ID_${landing}_STAGING`, 'CONVEX_DEPLOY_KEY'];
  const missing = required.filter(name => !env[name]);
  const configured = Object.keys(env).some(name => /^(VERCEL_|CONVEX_DEPLOY_KEY$)/.test(name) && env[name]);
  if (env.GITHUB_EVENT_NAME === 'push' && !configured) {
    return { status: 'skip', missing };
  }
  return { status: missing.length ? 'error' : 'ready', missing };
}
module.exports = { readiness };
if (require.main === module) {
  const result = readiness(process.env);
  require('node:fs').appendFileSync(process.env.GITHUB_OUTPUT, `ready=${result.status === 'ready'}\n`);
  const message = result.status === 'ready' ? 'Deployment credentials are configured.'
    : `Deployment is not set up${result.status === 'error' ? `; missing: ${result.missing.join(', ')}` : ''}. Run bun run deploy:setup. Automatic staging deploys begin when setup is complete.`;
  console.log(`${result.status === 'error' ? '::error::' : '::notice::'}${message}`);
  require('node:fs').appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
  if (result.status === 'error') process.exitCode = 1;
}
