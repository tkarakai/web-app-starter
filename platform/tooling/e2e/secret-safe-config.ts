/** Separate from the reporter so Playwright may load a CJS config and an ESM reporter. */
export function assertSecretSafeRunner() {
  if (process.argv.includes("--list")) return; // Discovery executes no test ceremonies.
  const reporter = process.argv.find(value => value.startsWith("--reporter="))?.slice("--reporter=".length);
  const worker = /^\d+$/.test(process.env.TEST_WORKER_INDEX ?? "");
  if (process.env.E2E_SAFE_RUNNER !== "1" || !process.env.E2E_SAFE_RESULT_FILE || !process.env.E2E_SAFE_REPORTER_PATH ||
      (!worker && reporter !== process.env.E2E_SAFE_REPORTER_PATH)) throw new Error("Use the secret-safe Playwright runner for browser execution");
}
