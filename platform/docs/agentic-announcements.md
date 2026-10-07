# Announcement MCP POC

This opt-in service adds five tools (`announcements_list`, `announcements_get`,
`announcements_create`, `announcements_update`, `announcements_delete`) on the admin app's
`POST /api/mcp` endpoint. UI APIs remain native Convex functions. Native handlers retain
validation, scheduling, audit identity and storage; MCP adds no separate business database.

## Authentication

The only registered client is `pi-announcements`, a public local test client. It discovers the
separate authorization origin and opens its `/settings/agent-access` page for sign-in, current security checks and explicit
consent. Consent uses an isolated, protected modal screen: it has no dashboard navigation,
status-banner controls or grant management. Focus stays inside the dialog, and Escape/outside
clicks cannot dismiss it. Approve access or explicitly deny it; denial returns an OAuth
`access_denied` response to pi without issuing a code or grant. Grant management remains a
separate dashboard page at `/settings/agent-grants` on the admin origin.
The redirect must use `http://127.0.0.1:<port>/callback`. Authorization-code exchange
requires S256 PKCE and the exact client, redirect and MCP resource. Codes expire after one
minute and are single-use. Grants expire after at most fifteen minutes and bind to the original
live session. Sign-out, revocation, expiry, ban, demotion or a newly unmet policy disables them.
Administrative writes require recent authentication on every call. Reauthenticate in the browser
and renew the grant when needed. Raw codes/tokens are stored only as hashes in Convex.

The grant provides announcement CRUD only. No refresh token, anonymous tools, arbitrary
Convex invocation, dynamic registration, service identities, publishing tool or other surface
is provided. Editing live content or assigning schedules can affect public announcements.

## Configure locally

Start the normal local dev harness with `bun run dev:admin`. Set runtime variables
`AGENT_MCP_ENABLED=true` and `AGENT_MCP_ORIGIN` to the canonical admin origin, without a
trailing slash. Set backend `AGENT_MCP_RESOURCE` to that origin plus `/api/mcp`. Disabled or
missing configuration fails closed. Also configure `AGENT_MCP_AUTH_ORIGIN` on both admin and backend. It must have a different
hostname from the admin origin. The default configured admin origin is `http://localhost:3002`;
use the actual configured port. Never set a cloud deployment key for the local dev harness.

## Adapter boundary

`@web-app-starter/agentic/catalogue` exports input schemas and descriptions; `/adapter` defines
`CapabilityAdapter.execute`. The admin Convex adapter validates inputs and calls grant-aware
native entry points. These entry points resolve grants and current policy inside the same
backend transaction as each write. Future surfaces can use the adapter without introducing a
new action engine or flattening Convex queries and mutations. Authentication credentials are
host context and are absent from tool input schemas and model context.

## Run the pi test conversation

From the repository root:

```sh
AGENT_MCP_ENABLED=true bun run dev:admin
# The launcher configures localhost:3002 + mcp-auth.localhost:3002 on the same listener.
# Enable Configure → Features → MCP server in the admin app, then in another terminal:
bun run agent:announcements -- --origin http://localhost:3002
```

The agent opens a browser. Sign in with your normal admin account, complete its security gate,
and select **Authorize pi announcement agent**. Return to the terminal and ask it to manage a
draft. For example: “Create a draft named October release with banner text Welcome to October.”
Then ask it to read, edit and delete that exact draft. `/auth` renews access without discarding the
conversation; `/quit` exits. Revoke grants at `/settings/agent-grants`.

Inference credentials are separate from app authorization. The conversation uses the
`@earendil-works/pi-coding-agent` SDK, pi's provider credentials and configured default model.
Override with `--provider <provider> --model <model>`. For provider login, use the installed pi
CLI's `/login` command (`bun platform/packages/announcement-agent/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js`).
An API-key provider can use its normal environment variable. Passwords, OTPs, app cookies and
grants are never tool parameters. Conversation history and app grants stay in process memory;
pi's existing inference credentials continue to use its normal credential store.

`--prompt "<request>"` runs one real pi conversation turn. `--smoke` instead runs deterministic
CRUD through an independent MCP SDK client after the same browser authentication; it needs no
model credentials. Set `AGENT_NO_OPEN=true` to use the printed browser link manually.

## Acceptance and limits

```sh
# Against the already running opt-in local deployment:
CI=true E2E_BASE_URL=http://localhost:3002 AGENT_MCP_ENABLED=true \
  bun run --cwd platform/apps/admin test:e2e agentic-mcp.spec.ts
bun run --cwd packages/backend test:convex agentAccess endpoint-authorization
bun run --cwd platform/packages/agentic test
```

The browser test covers logged-out sign-in continuation, consent, PKCE denial/replay, discovery,
CRUD, cleanup and grant revocation. Backend tests cover live session/role/ban/policy changes,
expiry and recent-write checks. The MCP transport tests use an independent SDK client.

This is a local POC with one registered client and one management scope. Its ingress limiter is
process-local and applies a shared request budget; production needs a shared limiter and a
review of consent, client onboarding and lifecycle. Expired codes/grants are removed by scheduled
cleanup; expiry enforcement does not depend on cleanup running. There is no durable agent job
or transcript store. `get` currently selects from the native full admin list, which is sufficient
for this bounded catalogue but should become an indexed read if announcement volume grows.
The schemas describe inputs; business rules remain in native functions. Do not automatically
retry a write after an uncertain transport failure.

## Operator control and origin isolation

**Configure → Features → MCP server** is the live availability switch. It defaults off, requires
recent normal admin authentication, and records an audit event. Disabling immediately blocks new
consent/exchanges and existing grant use. Every transition changes the generation, so re-enabling
requires fresh consent. Deployment configuration is an additional prerequisite, not authority
the UI can override.

The same Next.js deployment serves two hostnames; no second server is needed. Only authentication
and consent are exposed on the issuer hostname. Admin routes typed into its address bar return
404. Its host-only cookies hold MCP-authorization sessions; those sessions cannot invoke normal
admin Convex functions or administrative Better Auth APIs. Browsing the separate normal admin
host still uses that host's ordinary session. Recovery/enrollment belongs in the admin app.

See [local startup](development.md#optional-mcp-authorization-hostname),
[deployment architecture](deployment-architecture.md#optional-mcp-authorization-hostname) and
[rollout checklist](deployment-runbook.md#optional-mcp-authorization-origin).
