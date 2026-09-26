import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { checkRuntimeBaseline } from "../check-runtime-baseline.ts";

type Fixture = {
  nodeVersion?: string;
  engines?: string;
  packageManager?: string;
  actionNode?: string;
  actionBun?: string;
  workflowNode?: string;
  appTypes?: string;
  dockerNode?: string;
  dockerBun?: string;
};

function write(root: string, file: string, text: string): void {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}

function fixture(overrides: Fixture = {}): string {
  const f: Required<Fixture> = {
    nodeVersion: "24\n",
    engines: "24.x",
    packageManager: "bun@1.4.2",
    actionNode: "24",
    actionBun: "1.4.2",
    workflowNode: "24",
    appTypes: "24.13.4",
    dockerNode: "24",
    dockerBun: "1.4.2",
    ...overrides,
  };
  const root = mkdtempSync(path.join(tmpdir(), "runtime-baseline-"));
  write(root, ".node-version", f.nodeVersion);
  write(root, "package.json", JSON.stringify({
    packageManager: f.packageManager,
    engines: { node: f.engines },
    workspaces: ["apps/*"],
    devDependencies: { "@types/node": "24.13.4" },
  }));
  write(root, "apps/web/package.json", JSON.stringify({ devDependencies: { "@types/node": f.appTypes } }));
  write(root, ".github/actions/setup-bun/action.yml", [
    "inputs:",
    "  bun-version:",
    '    description: "Bun version to install"',
    `    default: "${f.actionBun}"`,
    "  node-version:",
    '    description: "Node.js version"',
    `    default: "${f.actionNode}"`,
    "runs:",
    "",
  ].join("\n"));
  write(root, "infra/aws/docker/next-app.Dockerfile", `ARG NODE_VERSION=${f.dockerNode}\nARG BUN_VERSION=${f.dockerBun}\n`);
  write(root, ".github/workflows/ci.yml", `steps:\n  - uses: ./.github/actions/setup-bun\n    with:\n      node-version: "${f.workflowNode}"\n`);
  return root;
}

function check(overrides: Fixture = {}): string[] {
  const root = fixture(overrides);
  try {
    return checkRuntimeBaseline(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("accepts a consistent baseline", () => {
  assert.deepEqual(check(), []);
});

test("reports each location that disagrees with .node-version", () => {
  assert.match(check({ engines: ">=22.6" }).join("\n"), /engines\.node is ">=22\.6", expected "24\.x"/);
  assert.match(check({ actionNode: "22" }).join("\n"), /node-version default is "22"/);
  assert.match(check({ workflowNode: "26" }).join("\n"), /ci\.yml sets node-version "26"/);
  assert.match(check({ appTypes: "^25.2.3" }).join("\n"), /apps\/web\/package\.json has @types\/node "\^25\.2\.3"/);
});

test("reports container images that disagree with the baseline", () => {
  assert.match(check({ dockerNode: "22" }).join("\n"), /next-app\.Dockerfile NODE_VERSION is "22", expected "24"/);
  assert.match(check({ dockerBun: "1.3.6" }).join("\n"), /next-app\.Dockerfile BUN_VERSION is "1\.3\.6", expected "1\.4\.2"/);
});

test("reports Bun drift and malformed inputs", () => {
  assert.match(check({ actionBun: "1.4.1" }).join("\n"), /bun-version default is "1\.4\.1", expected "1\.4\.2"/);
  assert.match(check({ packageManager: "npm@10.0.0" }).join("\n"), /expected bun@<version>/);
  assert.match(check({ nodeVersion: "v24.1.0\n" }).join("\n"), /must be a bare major/);
});

test("fails when .node-version is missing", () => {
  const root = fixture();
  try {
    rmSync(path.join(root, ".node-version"));
    assert.deepEqual(checkRuntimeBaseline(root), [".node-version is missing"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
