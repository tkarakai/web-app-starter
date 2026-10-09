import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { Page } from "@playwright/test";
import { observeOrganizationContact } from "../e2e/organization-contact-diagnostics.ts";
import { activity, contactObservations, htmlReport, textReport, validateReport } from "../e2e/secret-safe-report.ts";

const secret = "synthetic-password-totp-recovery-token";
const send = (socket: EventEmitter, value: unknown) => socket.emit("framesent", { payload: JSON.stringify(value) });
const receive = (socket: EventEmitter, value: unknown) => socket.emit("framereceived", { payload: JSON.stringify(value) });
const contact = (socket: EventEmitter, requestId = 1, organizationId = "org-a", memberId = "member-a") => send(socket, {
  type: "Mutation", udfPath: "platform/memberManagement:setContact", requestId, args: [{ organizationId, memberId }],
});
const subscribe = (socket: EventEmitter, queryId = 1, organizationId = "org-a", udfPath = "platform/memberManagement:directory") => send(socket, {
  type: "ModifyQuerySet", modifications: [{ type: "Add", queryId, udfPath, args: [{ organizationId }] }],
});
const directory = (socket: EventEmitter, isContact: boolean, queryId = 1, memberId = "member-a") => receive(socket, {
  type: "Transition", modifications: [{ type: "QueryUpdated", queryId, value: { page: [{ memberId, isContact, email: secret }] } }],
});
function fixture() {
  const page = new EventEmitter();
  const probe = observeOrganizationContact(page as unknown as Page);
  const socket = () => { const value = new EventEmitter(); page.emit("websocket", value); return value; };
  return { page, probe, socket };
}
const has = (probe: ReturnType<typeof observeOrganizationContact>, category: string) => assert.ok(probe.observations().includes(category as typeof contactObservations[number]), JSON.stringify(probe.observations()));

test("unavailable, observed no-send and unresolved dispatch are distinct", () => {
  const { probe, socket } = fixture();
  assert.deepEqual(probe.observations(), ["org-contact-observer-unavailable"]);
  const ws = socket(); send(ws, { type: "ModifyQuerySet", modifications: [] });
  has(probe, "org-contact-observer-complete"); has(probe, "org-contact-rpc-not-observed");
  contact(ws); has(probe, "org-contact-rpc-unresolved"); probe.dispose();
});

test("success and requested directory delivery require separate evidence", () => {
  const { probe, socket } = fixture(); const ws = socket(); subscribe(ws); contact(ws);
  receive(ws, { type: "MutationResponse", requestId: 1, success: true, result: secret });
  has(probe, "org-contact-rpc-succeeded"); has(probe, "org-contact-directory-unobserved");
  directory(ws, false); has(probe, "org-contact-directory-not-current");
  directory(ws, true); has(probe, "org-contact-directory-current"); probe.dispose();
});

test("rejection is retained without copying its private error", () => {
  const { probe, socket } = fixture(); const ws = socket(); contact(ws);
  receive(ws, { type: "MutationResponse", requestId: 1, success: false, errorMessage: secret });
  has(probe, "org-contact-rpc-rejected"); assert.ok(!JSON.stringify(probe.observations()).includes(secret)); probe.dispose();
});

test("socket-local request IDs cannot correlate another socket or action response", () => {
  const { probe, socket } = fixture(); const one = socket(); const two = socket(); contact(one);
  receive(two, { type: "MutationResponse", requestId: 1, success: true });
  receive(one, { type: "ActionResponse", requestId: 1, success: true });
  receive(one, { type: "MutationResponse", requestId: "1", success: true });
  receive(one, { type: "MutationResponse", requestId: 2, success: true });
  has(probe, "org-contact-rpc-unresolved");
  receive(one, { type: "MutationResponse", requestId: 1, success: true }); has(probe, "org-contact-rpc-succeeded"); probe.dispose();
});

test("unknown or near-match function paths never claim a contact dispatch", () => {
  const { probe, socket } = fixture(); const ws = socket();
  for (const [requestId, udfPath] of ["other:setContact", "platform/memberManagement:setContact:secret", "platform/memberManagement:setContacts"].entries()) {
    send(ws, { type: "Mutation", requestId, udfPath, args: [{ organizationId: "org-a", memberId: secret }] });
    receive(ws, { type: "MutationResponse", requestId, success: true });
  }
  has(probe, "org-contact-rpc-not-observed"); probe.dispose();
});

test("the pinned .js wire path and Buffer payload are supported", () => {
  const { probe, socket } = fixture(); const ws = socket();
  ws.emit("framesent", { payload: Buffer.from(JSON.stringify({ type: "Mutation", udfPath: "platform/memberManagement.js:setContact", requestId: 0, args: [{ organizationId: "org-a", memberId: "member-a" }] })) });
  receive(ws, { type: "MutationResponse", requestId: 0, success: true }); has(probe, "org-contact-rpc-succeeded"); probe.dispose();
});

for (const variant of ["same-socket-replay", "reconnect-replay", "unrelated-reused-id", "duplicate-response"] as const) test(`ambiguous ${variant} is never a clean success`, () => {
  const { probe, socket } = fixture(); const ws = socket(); contact(ws);
  receive(ws, { type: "MutationResponse", requestId: 1, success: true });
  if (variant === "same-socket-replay") contact(ws);
  if (variant === "reconnect-replay") { ws.emit("close"); contact(socket()); }
  if (variant === "unrelated-reused-id") send(ws, { type: "Mutation", requestId: 1, udfPath: "other:operation", args: [] });
  if (variant === "duplicate-response") receive(ws, { type: "MutationResponse", requestId: 1, success: false });
  has(probe, "org-contact-rpc-ambiguous"); assert.ok(!probe.observations().includes("org-contact-rpc-succeeded")); probe.dispose();
});

test("different directory organization, function and target do not produce requested contact", () => {
  const { probe, socket } = fixture(); const ws = socket(); contact(ws);
  subscribe(ws, 1, "org-b"); directory(ws, true); has(probe, "org-contact-directory-unobserved");
  subscribe(ws, 2, "org-a", "other:directory"); directory(ws, true, 2); has(probe, "org-contact-directory-unobserved");
  subscribe(ws, 3); directory(ws, true, 3, "other-member"); has(probe, "org-contact-directory-target-absent");
  directory(ws, true, 3); has(probe, "org-contact-directory-current"); probe.dispose();
});

test("removed and remapped query IDs do not retain directory authority", () => {
  const { probe, socket } = fixture(); const ws = socket(); contact(ws); subscribe(ws);
  send(ws, { type: "ModifyQuerySet", modifications: [{ type: "Remove", queryId: 1 }] });
  directory(ws, true); has(probe, "org-contact-directory-unobserved");
  subscribe(ws, 1, "org-a", "other:directory"); directory(ws, true); has(probe, "org-contact-directory-unobserved"); probe.dispose();
});

test("query failures stay distinct from false and malformed rows", () => {
  const { probe, socket } = fixture(); const ws = socket(); contact(ws); subscribe(ws);
  receive(ws, { type: "Transition", modifications: [{ type: "QueryFailed", queryId: 1, errorMessage: secret }] });
  has(probe, "org-contact-directory-error");
  receive(ws, { type: "Transition", modifications: [{ type: "QueryUpdated", queryId: 1, value: { page: [{ memberId: "member-a", isContact: secret }] } }] });
  has(probe, "org-contact-observer-incomplete"); assert.ok(!probe.observations().includes("org-contact-directory-current")); probe.dispose();
});

test("malformed, hostile and oversized frames cannot throw or claim complete coverage", () => {
  const { probe, socket } = fixture(); const ws = socket();
  for (const payload of ["{", "null", "[]", secret.repeat(3000), { toString() { throw new Error(secret); } }]) assert.doesNotThrow(() => ws.emit("framesent", { payload }));
  assert.doesNotThrow(() => ws.emit("framereceived", { get payload() { throw new Error(secret); } }));
  ws.emit("framesent", { payload: '{"__proto__":{"polluted":"private"},"type":"unrecognized"}' });
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  has(probe, "org-contact-observer-incomplete"); has(probe, "org-contact-rpc-not-observed"); probe.dispose();
});

test("malformed contact arguments and success type stay ambiguous", () => {
  for (const args of [null, [], [{ organizationId: "a", memberId: "" }], [{ organizationId: "a", memberId: secret.repeat(40) }]]) {
    const { probe, socket } = fixture(); const ws = socket(); send(ws, { type: "Mutation", requestId: 1, udfPath: "platform/memberManagement:setContact", args });
    receive(ws, { type: "MutationResponse", requestId: 1, success: true }); has(probe, "org-contact-rpc-ambiguous"); probe.dispose();
  }
  const { probe, socket } = fixture(); const ws = socket(); contact(ws); receive(ws, { type: "MutationResponse", requestId: 1, success: "true" });
  has(probe, "org-contact-rpc-ambiguous"); probe.dispose();
});

test("bounded sockets, frames and query/request IDs stop observation and remove listeners", () => {
  for (const limit of ["sockets", "frames", "queries", "requests"]) {
    const { page, probe, socket } = fixture(); const ws = socket();
    if (limit === "sockets") for (let i = 0; i < 8; i++) socket();
    if (limit === "frames") for (let i = 0; i < 2049; i++) send(ws, { type: "Ping" });
    if (limit === "queries") for (let i = 0; i < 129; i++) subscribe(ws, i);
    if (limit === "requests") for (let i = 0; i < 129; i++) send(ws, { type: "Mutation", requestId: i, udfPath: "other:op" });
    has(probe, "org-contact-observer-incomplete"); assert.equal(ws.eventNames().length, 0);
    const extra = socket(); assert.equal(extra.eventNames().length, 0); probe.dispose(); assert.equal(page.eventNames().length, 0);
  }
});

test("reconnect, socket errors and page cleanup are explicitly incomplete or unavailable", () => {
  const { page, probe, socket } = fixture(); const ws = socket(); contact(ws); ws.emit("socketerror", secret); has(probe, "org-contact-observer-incomplete");
  ws.emit("close"); assert.equal(ws.eventNames().length, 0); has(probe, "org-contact-rpc-unresolved");
  const fresh = socket(); receive(fresh, { type: "MutationResponse", requestId: 1, success: true }); has(probe, "org-contact-rpc-unresolved");
  page.emit("close"); assert.equal(fresh.eventNames().length, 0); assert.equal(page.eventNames().length, 0);
  assert.deepEqual(probe.observations(), ["org-contact-observer-unavailable"]); probe.dispose();
});

test("exact closed categories survive safe rendering; private extras and lookalike titles never do", () => {
  const { probe, socket } = fixture(); const ws = socket(); contact(ws, 1, secret, secret); subscribe(ws, 1, secret); directory(ws, true, 1, secret);
  for (const name of contactObservations) {
    assert.equal(activity("test.step", name), name); assert.equal(activity("test.step", `${name}:${secret}`), "step"); assert.equal(activity("pw:api", name), "api");
  }
  const base = { version: 1, status: "failed", globalErrors: [], suppressedOutputBytes: 0, tests: [{ number: 1, file: "organization-journeys.spec.ts", line: 112, column: 1, outcome: "unexpected", attempts: [{ status: "failed", expectedStatus: "passed", retry: 0, durationMs: 1, diagnostics: ["assertion"], activities: Object.fromEntries(probe.observations().map(k => [k, 1])), failures: [], secret }] }] };
  const report = validateReport(base);
  for (const out of [JSON.stringify(report), htmlReport(report), textReport(report), textReport(report, true)]) assert.ok(!out.includes(secret));
  assert.throws(() => validateReport({ ...base, tests: [{ ...base.tests[0], attempts: [{ ...base.tests[0].attempts[0], activities: { [`org-contact-rpc-succeeded:${secret}`]: 1 } }] }] })); probe.dispose();
});

// Execute the actual wrapper with supported API-shaped doubles; no browser/process is launched.
function wrapper() {
  type Fixture = (values: Record<string, unknown>, use: () => Promise<void>, info?: { timeout: number }) => Promise<void>;
  let fixtures: Record<string, [Fixture, unknown]> = {};
  const info = { timeout: 10_000 };
  const emitted: string[] = [];
  const page = Object.assign(new EventEmitter(), { evaluate: async () => ["org-visible"] });
  const playwright = { test: { extend: (value: typeof fixtures) => { fixtures = value; return {}; }, info: () => info, step: async (title: string, call: () => unknown) => { emitted.push(title); await call(); } } };
  const source = readFileSync(new URL("../e2e/organizations.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: { expectOrganizationTransition?: (page: unknown, id: string, assertion: () => Promise<void>, row?: unknown) => Promise<void> } = {};
  runInNewContext(compiled, { exports, setTimeout, clearTimeout, require: (name: string) => {
    if (name === "@playwright/test") return playwright;
    if (name === "node:perf_hooks") return { performance };
    if (name.endsWith("organization-contact-diagnostics.ts")) return { observeOrganizationContact };
    if (name.endsWith("customer-auth.ts")) return {};
    throw new Error("Unexpected wrapper import");
  } });
  return { page, emitted, fixtures, info, playwright, run: async (call: () => Promise<void>) => fixtures.organizationDiagnosticClock[0]({}, () => fixtures.organizationContactEvidence[0]({ page, organizationDiagnosticClock: undefined }, call), info), expect: exports.expectOrganizationTransition! };
}

test("actual fixture attaches before navigation, success awaits no diagnostic, cleanup removes listeners", async () => {
  const w = wrapper(); let calls = 0;
  w.page.evaluate = async () => { throw new Error("Passing assertion must not probe DOM"); };
  await w.run(async () => {
    assert.equal(w.page.listenerCount("websocket"), 1);
    await w.expect(w.page, secret, async () => { calls++; }, {});
    assert.equal(w.emitted.length, 0);
  });
  assert.equal(calls, 1); assert.equal(w.page.eventNames().length, 0);
});

test("actual failure wrapper emits closed evidence and rethrows the identical original error", async () => {
  const w = wrapper(); const original = new Error(secret);
  await w.run(async () => {
    const ws = new EventEmitter(); w.page.emit("websocket", ws); contact(ws); receive(ws, { type: "MutationResponse", requestId: 1, success: false, errorMessage: secret });
    await assert.rejects(w.expect(w.page, secret, async () => { throw original; }, { allTextContents: async () => ["Member"] }), error => error === original);
    assert.ok(w.emitted.includes("org-contact-rpc-rejected")); assert.ok(!w.emitted.some(x => x.includes(secret)));
  });
  assert.equal(w.page.eventNames().length, 0);
});

test("chunked transitions mark coverage incomplete instead of implying complete absence", () => {
  const { probe, socket } = fixture(); const ws = socket();
  receive(ws, { type: "TransitionChunk", partNumber: 0, totalParts: 1, chunk: secret });
  has(probe, "org-contact-observer-incomplete"); probe.dispose();
});

test("same path in a non-root component cannot masquerade as the public contact RPC", () => {
  const { probe, socket } = fixture(); const ws = socket();
  send(ws, { type: "Mutation", udfPath: "platform/memberManagement:setContact", componentPath: "other-component", requestId: 1, args: [{ organizationId: "org-a", memberId: "member-a" }] });
  receive(ws, { type: "MutationResponse", requestId: 1, success: true }); has(probe, "org-contact-rpc-not-observed");
  contact(ws, 2);
  send(ws, { type: "ModifyQuerySet", modifications: [{ type: "Add", queryId: 1, udfPath: "platform/memberManagement:directory", componentPath: "other-component", args: [{ organizationId: "org-a" }] }] });
  directory(ws, true); has(probe, "org-contact-directory-unobserved"); probe.dispose();
});

test("removed then reused query ID is quarantined from stale updates", () => {
  const { probe, socket } = fixture(); const ws = socket(); contact(ws); subscribe(ws);
  send(ws, { type: "ModifyQuerySet", modifications: [{ type: "Remove", queryId: 1 }] }); subscribe(ws);
  directory(ws, true); has(probe, "org-contact-observer-incomplete"); has(probe, "org-contact-directory-unobserved"); probe.dispose();
});

test("withdrawn directory cannot keep an old current-contact observation", () => {
  for (const serverRemoval of [false, true]) {
    const { probe, socket } = fixture(); const ws = socket(); contact(ws); subscribe(ws); directory(ws, true);
    if (serverRemoval) receive(ws, { type: "Transition", modifications: [{ type: "QueryRemoved", queryId: 1 }] });
    else send(ws, { type: "ModifyQuerySet", modifications: [{ type: "Remove", queryId: 1 }] });
    has(probe, "org-contact-directory-unobserved"); directory(ws, true); has(probe, "org-contact-directory-unobserved"); probe.dispose();
  }
});

test("failure of diagnostic emission cannot replace the original assertion error", async () => {
  const w = wrapper(); const original = new Error(secret); w.playwright.test.step = async () => { throw new Error("probe failure"); };
  await w.run(async () => {
    await assert.rejects(w.expect(w.page, secret, async () => { throw original; }, { allTextContents: async () => ["Member"] }), error => error === original);
  });
  assert.equal(w.page.eventNames().length, 0);
});

test("exhausted original diagnostic budget does not query or extend the failure", async () => {
  const w = wrapper(); w.info.timeout = 1; const original = new Error(secret);
  w.page.evaluate = async () => { throw new Error("No remaining budget"); };
  await w.run(async () => { await assert.rejects(w.expect(w.page, secret, async () => { throw original; }, {}), error => error === original); });
  assert.equal(w.emitted.length, 0);
});

test("a later coverage gap clears stale directory evidence but retains an observed RPC fact", () => {
  for (const gap of ["chunk", "oversize", "auth", "close"]) {
    const { probe, socket } = fixture(); const ws = socket(); subscribe(ws); contact(ws); directory(ws, true);
    receive(ws, { type: "MutationResponse", requestId: 1, success: true });
    if (gap === "chunk") receive(ws, { type: "TransitionChunk", chunk: secret });
    if (gap === "oversize") ws.emit("framereceived", { payload: secret.repeat(3000) });
    if (gap === "auth") receive(ws, { type: "AuthError", error: secret });
    if (gap === "close") ws.emit("close");
    has(probe, "org-contact-observer-incomplete"); has(probe, "org-contact-directory-unobserved"); has(probe, "org-contact-rpc-succeeded"); probe.dispose();
  }
});


test("an empty or unrelated websocket does not claim observed contact coverage", () => {
  const { probe, socket } = fixture(); const ws = socket();
  assert.deepEqual(probe.observations(), ["org-contact-observer-unavailable"]);
  send(ws, { type: "chat", body: secret }); receive(ws, { type: "chat-ack" });
  assert.deepEqual(probe.observations(), ["org-contact-observer-unavailable"]); probe.dispose();
});

test("multiple directory pages cannot overwrite target evidence with another page", () => {
  for (const reverse of [false, true]) {
    const { probe, socket } = fixture(); const ws = socket(); subscribe(ws, 1); subscribe(ws, 2); contact(ws);
    const modifications = [
      { type: "QueryUpdated", queryId: 1, value: { page: [{ memberId: "member-a", isContact: true }] } },
      { type: "QueryUpdated", queryId: 2, value: { page: [{ memberId: "other-member", isContact: false }] } },
    ];
    receive(ws, { type: "Transition", modifications: reverse ? modifications.reverse() : modifications });
    has(probe, "org-contact-observer-incomplete"); has(probe, "org-contact-directory-unobserved"); probe.dispose();
  }
});

test("overlapping directory subscriptions across sockets clear prior target claims", () => {
  const { probe, socket } = fixture(); const first = socket(); subscribe(first); contact(first); directory(first, true);
  has(probe, "org-contact-directory-current"); const second = socket(); subscribe(second);
  has(probe, "org-contact-observer-incomplete"); has(probe, "org-contact-directory-unobserved");
  directory(second, false); has(probe, "org-contact-directory-unobserved"); probe.dispose();
});

test("a second contact target discards the first target directory evidence", () => {
  const { probe, socket } = fixture(); const ws = socket(); subscribe(ws); contact(ws); directory(ws, true);
  contact(ws, 2, "org-a", "member-b"); has(probe, "org-contact-rpc-ambiguous");
  has(probe, "org-contact-directory-unobserved"); directory(ws, true);
  has(probe, "org-contact-directory-unobserved"); probe.dispose();
});
