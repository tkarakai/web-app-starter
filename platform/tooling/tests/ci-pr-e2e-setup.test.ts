import assert from "node:assert/strict";
import { test } from "node:test";
import { applyPrE2e, describeModes, needsChoice, prE2eStatus, type Exec } from "../ci-pr-e2e-setup.ts";
import { parseArgs, settlePrE2e } from "../adopt.ts";

function fakeGh(repository: { private: boolean }, variables: { name: string; value: string }[]) {
  const calls: string[][] = [];
  const exec: Exec = async (file, args) => {
    assert.equal(file, "gh");
    calls.push(args);
    if (args[0] === "api" && args[1] === "repos/acme/app") return JSON.stringify(repository);
    if (args[0] === "api" && args[1]?.startsWith("repos/acme/app/actions/variables")) return JSON.stringify(variables);
    if (args[0] === "variable" || args[0] === "label") return "";
    throw new Error(`unexpected gh ${args.join(" ")}`);
  };
  return { calls, exec };
}

test("status reads visibility and the shared variables; only an undecided private repository is asked", async () => {
  const unset = await prE2eStatus("acme/app", fakeGh({ private: true }, []).exec);
  assert.deepEqual(unset, { private: true, mode: undefined, legacySkip: false });
  assert.equal(needsChoice(unset), true);
  const chosen = await prE2eStatus("acme/app", fakeGh({ private: true }, [{ name: "PLATFORM_CI_PR_E2E", value: "off" }, { name: "SKIP_E2E", value: "true" }]).exec);
  assert.deepEqual(chosen, { private: true, mode: "off", legacySkip: true });
  assert.equal(needsChoice(chosen), false);
  assert.equal(needsChoice({ private: false, legacySkip: false }), false);
  assert.ok(describeModes("acme/app", { private: true, legacySkip: true }).some(line => /SKIP_E2E=true is set/.test(line)));
});

test("apply sets the mode, creates the label for on-demand and replaces SKIP_E2E", async () => {
  const gh = fakeGh({ private: true }, []);
  assert.deepEqual(await applyPrE2e("acme/app", "on-demand", { private: true, legacySkip: true }, gh.exec), ["PLATFORM_CI_PR_E2E=on-demand", "label run-e2e", "deleted SKIP_E2E"]);
  assert.deepEqual(gh.calls[0], ["variable", "set", "PLATFORM_CI_PR_E2E", "--repo", "acme/app", "--body", "on-demand"]);
  assert.deepEqual(gh.calls[1]?.slice(0, 4), ["label", "create", "run-e2e", "--repo"]);
  assert.ok(gh.calls[1]?.includes("--force"));
  assert.deepEqual(gh.calls[2], ["variable", "delete", "SKIP_E2E", "--repo", "acme/app"]);
  const always = fakeGh({ private: true }, []);
  assert.deepEqual(await applyPrE2e("acme/app", "always", { private: true, legacySkip: false }, always.exec), ["PLATFORM_CI_PR_E2E=always"]);
  assert.equal(always.calls.length, 1);
});

test("adopt takes --pr-e2e and settles the choice after adoption", async () => {
  assert.equal(parseArgs(["--pr-e2e", "on-demand"]).prE2e, "on-demand");
  assert.throws(() => parseArgs(["--pr-e2e", "sometimes"]), /--pr-e2e takes always, on-demand or off/);

  const lines: string[] = [];
  const chosen = fakeGh({ private: true }, []);
  await settlePrE2e("acme/app", "off", chosen.exec, line => lines.push(line));
  assert.match(lines.join("\n"), /Set PLATFORM_CI_PR_E2E=off \(shared by everyone's CI runs in acme\/app\)/);

  lines.length = 0;
  await settlePrE2e("acme/app", undefined, fakeGh({ private: true }, []).exec, line => lines.push(line));
  assert.match(lines.join("\n"), /Private repository: .*gh variable set PLATFORM_CI_PR_E2E --repo acme\/app/);

  lines.length = 0;
  await settlePrE2e("acme/app", undefined, fakeGh({ private: false }, []).exec, line => lines.push(line));
  assert.match(lines.join("\n"), /Public repository/);

  lines.length = 0;
  await settlePrE2e("acme/app", "always", async () => { throw new Error("HTTP 404"); }, line => lines.push(line));
  assert.match(lines.join("\n"), /Could not read acme\/app's Actions variables/);
});
