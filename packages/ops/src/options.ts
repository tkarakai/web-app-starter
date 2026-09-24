import { usage } from "./errors";
export interface Options {
  command: string; args: string[]; json: boolean; debug: boolean; watch: boolean;
  yes: boolean; dryRun: boolean; active: boolean; config?: string; repo?: string;
  app?: string; env?: string; to?: string; since?: string; ref?: string; team?: string;
  limit: number; interval: number; timeout: number;
  until?: string; run?: number; attempt?: number; request?: string;
  allCommits?: boolean;
  // Internal context from a reviewed/resumed guided operation; never parsed from argv.
  expectedRepository?: string; expectedSha?: string; signal?: globalThis.AbortSignal;
}
const commands = new Set(["status", "history", "builds", "candidates", "inspect", "diff", "runs", "watch", "logs", "deploy", "rollback", "projects", "teams", "auth", "setup", "doctor", "diagnose", "verify", "console", "help"]);
export function parseOptions(argv: string[]): Options {
  const o: Options = { command: "status", args: [], json: false, debug: false, watch: false, yes: false, dryRun: false, active: false, limit: 30, interval: 10, timeout: 1800 };
  let found = false;
  const supplied = new Set<string>();
  const booleans: Record<string, string> = { json: "json", debug: "debug", watch: "watch", yes: "yes", "dry-run": "dryRun", active: "active", help: "help", "all-commits": "allCommits" };
  const strings = new Set(["config", "repo", "app", "env", "to", "since", "ref", "limit", "interval", "timeout", "team", "until", "run", "attempt", "request"]);
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const [key, inline] = token.slice(2).split(/=(.*)/s);
      supplied.add(key);
      if (key in booleans) {
        if (inline !== undefined) usage(`--${key} does not take a value.`);
        if (key === "help") o.command = "help";
        else (o as unknown as Record<string, unknown>)[booleans[key]] = true;
      } else if (strings.has(key)) {
        const value = inline ?? argv[++i];
        if (!value || value.startsWith("--")) usage(`--${key} requires a value.`);
        (o as unknown as Record<string, unknown>)[key] = ["limit", "interval", "timeout", "run", "attempt"].includes(key) ? Number(value) : value;
      } else usage(`Unknown option --${key}.`);
    } else if (!found) {
      if (!commands.has(token)) usage(`Unknown command ${token}.`);
      if (o.command !== "help") o.command = token;
      found = true;
    } else o.args.push(token);
  }
  for (const [key, max] of [["limit", 1000], ["interval", 60], ["timeout", 86400]] as const) {
    if (!Number.isInteger(o[key]) || o[key] < 1 || o[key] > max) usage(`--${key} must be an integer between 1 and ${max}.`);
  }
  for (const value of [o.env, o.to]) if (value && !["staging", "production"].includes(value)) usage("Environment must be staging or production.");
  if (o.since && !Number.isFinite(Date.parse(o.since))) usage("--since must be an ISO date or timestamp.");
  const counts: Record<string, number> = { inspect: 1, diff: 2, watch: o.request ? 0 : 1, logs: 1, diagnose: 1, deploy: 1, rollback: 1 };
  if (o.command === "auth") {
    if (!(o.args.length === 1 && o.args[0] === "status") && !(o.args.length === 2 && o.args[0] === "login" && ["github", "vercel"].includes(o.args[1]))) usage("Use ops auth status or ops auth login github|vercel.");
  } else if (o.command !== "help" && o.args.length !== (counts[o.command] ?? 0)) usage(`${o.command} expects ${counts[o.command] ?? 0} positional argument(s).`);
  if (["watch", "logs", "diagnose"].includes(o.command) && !o.request && !/^\d+$/.test(o.args[0])) usage("Run ID must be numeric.");
  if (o.watch && !["status", "runs", "deploy", "rollback"].includes(o.command)) usage("--watch is supported for status, runs, deploy, and rollback.");
  if (o.active && o.command !== "runs") usage("--active is only supported for runs.");
  if ((o.yes || o.dryRun || o.ref) && !["deploy", "rollback"].includes(o.command)) usage("--yes, --dry-run, and --ref are deployment options.");
  if (o.command !== "help") {
    const allowed: Record<string, string[]> = {
      app: ["status", "history", "builds", "inspect", "diff"],
      env: ["status", "history", "deploy", "rollback", "verify"],
      to: ["candidates", "inspect", "deploy", "rollback"],
      since: ["history", "builds", "runs"],
      limit: ["status", "history", "builds", "candidates", "runs"],
      team: ["projects", "setup"],
      until: ["watch", "deploy", "rollback"], run: ["verify"],
      attempt: ["watch", "logs", "diagnose", "verify"], request: ["watch"],
    };
    for (const [flag, commands] of Object.entries(allowed)) if (supplied.has(flag) && !commands.includes(o.command)) usage(`--${flag} is not supported for ${o.command}.`);
    if ((supplied.has("interval") || supplied.has("timeout")) && !o.watch && o.command !== "watch") usage("--interval and --timeout require a watch command or --watch.");
    if (o.until && (o.until !== "serving" || (o.command !== "watch" && !o.watch))) usage("--until serving requires watch or deploy/rollback --watch.");
    for (const [key, value] of [["run", o.run], ["attempt", o.attempt]] as const) if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) usage(`--${key} must be a positive integer.`);
    if (o.command === "verify" && !o.run) usage("Use ops verify --run RUN_ID [--env staging|production].");
    if (o.request && !/^[a-zA-Z0-9-]{1,100}$/.test(o.request)) usage("Invalid request ID.");
    if (o.dryRun && (o.watch || o.yes)) usage("--dry-run cannot be combined with --yes or --watch.");
    if (o.to && o.env && o.to !== o.env) usage("--to and --env must agree.");
    if (o.allCommits && (o.command !== "candidates" || o.to !== "staging")) usage("--all-commits requires candidates --to staging.");
    if (o.active && o.since) usage("--active and --since cannot be combined; active runs are searched independently of age.");
  }
  return o;
}
