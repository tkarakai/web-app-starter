import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";

// Execute the real entry point in an isolated VM. No global module mocks,
// credentials, network requests, provider calls or backend fixtures are involved.
const source = readFileSync(new URL("../src/simulator.ts", import.meta.url), "utf8")
  .replace("main().catch", "globalThis.done = main().catch");
const executable = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const invalidModes = ["empty-discovery", "empty-describe", "missing", "duplicate", "foreign", "reordered", "nonarray", "null-schema", "array-schema", "wrong-schema"] as const;
type Mode = "valid" | typeof invalidModes[number];

async function simulate(mode: Mode) {
  let stdout = ""; let stderr = ""; let removed = false;
  let describeCalls = 0; let activeDescribe = 0; let maxDescribe = 0;
  let executeCalls = 0; let activeExecute = 0; let maxExecute = 0;
  const names = mode === "empty-discovery" ? [] : Array.from({ length: 81 }, (_, index) => `synthetic_${index}`);
  const described: string[] = [];
  const executed: string[] = [];
  const processStub = { env: {}, argv: ["bun", "simulator.ts"], exitCode: 0,
    stdout: { write(value: string) { stdout += value; } }, stderr: { write(value: string) { stderr += value; } } };
  const client = {
    async listTools() { return { tools: [] }; },
    async close() {},
    async callTool({ name, arguments: input }: { name: string; arguments: Record<string, unknown> }) {
      let value: unknown;
      if (name === "capabilities_search") {
        const start = input.offset as number; const end = start + (input.limit as number);
        value = { matches: names.slice(start, end).map(name => ({ name, effect: "read" })), nextOffset: end >= names.length ? null : end };
      } else if (name === "capabilities_describe") {
        describeCalls++; activeDescribe++; maxDescribe = Math.max(maxDescribe, activeDescribe);
        await new Promise(resolve => setTimeout(resolve, 2)); activeDescribe--;
        const requested = input.names as string[]; described.push(...requested);
        const rows: { name: string; inputSchema: unknown }[] = requested.map(name => ({ name, inputSchema: { type: "object" } }));
        if (mode === "missing") rows.pop();
        if (mode === "duplicate") rows[1] = rows[0];
        if (mode === "foreign") rows[0].name = "foreign";
        if (mode === "reordered") rows.reverse();
        if (mode === "null-schema") rows[0].inputSchema = null;
        if (mode === "array-schema") rows[0].inputSchema = [];
        if (mode === "wrong-schema") rows[0].inputSchema = { type: "string" };
        value = mode === "empty-describe" ? [] : mode === "nonarray" ? {} : rows;
      } else {
        executeCalls++; activeExecute++; maxExecute = Math.max(maxExecute, activeExecute);
        await new Promise(resolve => setTimeout(resolve, 1)); activeExecute--;
        const capability = input.name as string; executed.push(capability);
        if (capability === "announcements_create") value = { result: { id: "synthetic-draft" } };
        else if (capability === "announcements_delete") { removed = true; value = { result: null }; }
        else if (capability === "announcements_get") value = { result: removed ? null : { bannerText: "Simulator updated" } };
        else value = { result: {} };
      }
      return { content: [{ text: JSON.stringify(value) }] };
    },
  };
  const sandbox = { exports: {}, process: processStub, done: undefined as Promise<void> | undefined,
    require(id: string): unknown {
      if (id === "node:perf_hooks") return { performance };
      if (id === "node:fs/promises") return { writeFile: async () => { throw new Error("Unexpected evidence file write"); } };
      if (id === "./auth") return { authenticate: async () => "synthetic-token" };
      if (id === "./client") return { connectMcp: async () => client };
      if (id === "./cli-client") return { connectCli: () => client };
      if (id === "./a2a-client") return { connectA2a: async () => client };
      throw new Error(`Unexpected simulator dependency: ${id}`);
    },
  };
  runInContext(executable, createContext(sandbox));
  await sandbox.done;
  return { exitCode: processStub.exitCode, stdout, stderr, names, described, executed, describeCalls, maxDescribe, executeCalls, maxExecute, removed };
}

test("full catalogue validates each schema with bounded reads and serial draft cleanup", async () => {
  const result = await simulate("valid");
  expect(result.exitCode).toBe(0); expect(result.stderr).toBe("");
  expect(result.describeCalls).toBe(27); expect(result.maxDescribe).toBe(3);
  expect(result.described.sort()).toEqual(result.names.sort());
  expect(new Set(result.described).size).toBe(81);
  expect(result.maxExecute).toBe(1); expect(result.executeCalls).toBe(25);
  expect(result.executed.slice(-5)).toEqual(["announcements_create", "announcements_update", "announcements_get", "announcements_delete", "announcements_get"]);
  expect(result.removed).toBe(true);
  expect(JSON.parse(result.stdout)).toMatchObject({ capabilities: 81, requests: 58, disposableDraftCleaned: true });
});

for (const mode of invalidModes) test(`rejects ${mode} before any capability execution`, async () => {
  const result = await simulate(mode);
  expect(result.exitCode).toBe(1); expect(result.stderr).not.toBe("");
  expect(result.stdout).toBe(""); expect(result.executeCalls).toBe(0);
});
