import type { Config } from "../src/types";

// Evidence fixtures describe a deployment, independent of the reference apps
// retained in the checkout running the tests. Filesystem selection has its own tests.
export function fixtureConfig(): Config {
  return { repository: "team/repo", workflowRef: "main", apps: {
    web: { projects: {} }, admin: { projects: {} }, landing: { projects: {} },
  } };
}
