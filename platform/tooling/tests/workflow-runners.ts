import { execFileSync } from "node:child_process";
import { createContext, Script } from "node:vm";

export interface WorkflowJob {
  "runs-on"?: string | string[];
  if?: string;
  steps?: { run?: string }[];
}
export interface Workflow { jobs: Record<string, WorkflowJob> }
export function parseWorkflow(content: string): Workflow {
  return JSON.parse(execFileSync("bun", ["-e", "console.log(JSON.stringify(Bun.YAML.parse(await new Response(Bun.stdin.stream()).text())))"], { input: content, encoding: "utf8" })) as Workflow;
}
export const source = "a".repeat(40), verifiedSource = "b".repeat(40);
export const localSignals = {
  PLATFORM_CI_LOCAL_ONLY: "true", PLATFORM_CI_WORKER_POOL: "starter-pool",
  PLATFORM_CI_AUX_RUNNER: "starter-aux", PLATFORM_CI_RUNNER: "starter-legacy",
  PLATFORM_UPDATE_RUNNER: "starter-update", PLATFORM_UPDATE_DELIVERY_RUNNER: "starter-delivery",
};
export function evaluator(privacy: boolean | undefined | null, vars: Record<string, string> = {}, event = "push", workflow = "CI Web") {
  const context = createContext({
    github: { event: { repository: { private: privacy } }, event_name: event, workflow, sha: source, run_id: 123, run_attempt: 2 },
    vars: new Proxy(vars, { get: (values, name: string) => values[name] ?? "" }),
    inputs: { git_sha: verifiedSource, worker_check: true, worker_pool: "starter-diagnostic", verify: JSON.stringify({ pool: "starter-verify" }), deliver: JSON.stringify({ pool: "starter-deliver" }) },
    needs: { check: { outputs: { head: verifiedSource } } },
    format: (template: string, ...values: unknown[]) => template.replace(/\{(\d+)\}/g, (_, index: string) => String(values[Number(index)])),
    fromJSON: JSON.parse, toJSON: JSON.stringify, startsWith: (value: string, prefix: string) => value.startsWith(prefix),
  });
  const scripts = new Map<string, Script>();
  const expression = (text: string): unknown => {
    let script = scripts.get(text);
    if (!script) { script = new Script(text); scripts.set(text, script); }
    return script.runInContext(context, { timeout: 1000 });
  };
  const value = (text: string): unknown => {
    if (text.startsWith("${{") && text.endsWith("}}")) return expression(text.slice(3, -2));
    return text.replace(/\$\{\{(.*?)\}\}/g, (_, code: string) => String(expression(code)));
  };
  return { context, expression, value,
    runners: (selector: string | string[]): string[] => {
      const result = Array.isArray(selector) ? selector.map(label => value(label)) : value(selector);
      return Array.isArray(result) ? Array.from(result) as string[] : [String(result)];
    },
  };
}
