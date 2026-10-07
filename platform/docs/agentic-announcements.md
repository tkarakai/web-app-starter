# Admin agentic surfaces

The admin app offers four independently controlled interfaces over one light capability
catalogue: remote MCP, an authenticated CLI transport, live-page WebMCP and A2A tasks. Convex
and Better Auth remain the database and authentication authority. No extra application server,
agent-native Core runtime, foreign database or inference service is required.

## Enable and authenticate

**Configure → Features** contains **MCP server**, **Admin CLI**, **WebMCP** and **A2A** switches.
All default off. Changes require a normal admin session and recent verification, and are audited.
Disabling a remote surface blocks its requests and invalidates that surface's grants. Re-enabling
requires fresh consent; other surfaces retain their own controls. Grants are managed at
`/settings/agent-grants`.

For local remote interfaces:

```sh
AGENT_MCP_ENABLED=true bun run dev:admin
# Enable the desired interface in Configure → Features.
```

The existing `AGENT_MCP_*` deployment variables configure the common remote infrastructure:
canonical admin origin, separate authorization hostname and backend resource base. They do not
replace the four database switches. Defaults are `http://localhost:3002` and
`http://mcp-auth.localhost:3002`, served by the same Next.js process. Hosted deployments need an
additional DNS/TLS hostname on the admin deployment, as described in
[the deployment runbook](deployment-runbook.md). WebMCP alone uses the normal admin session
and does not require the remote authorization hostname.

Remote clients discover protected-resource metadata, open the auth-only origin, and request
blanket **`admin:manage`** permission. Consent describes broad administration: private data,
users/sessions, invitations, policy/settings, publishing and deletion. It does not list every
operation. Native role checks, validation, current security policy and recent verification still
apply. Earlier `announcements:manage` grants are rejected; authorize again.

The registered public test client remains `pi-announcements` for compatibility. Redirects must
be `http://127.0.0.1:<port>/callback`. Authorization uses S256 PKCE and state; one-minute codes
are single-use, and grants last at most fifteen minutes. Writes require verification within five
minutes, matching the existing administrative write policy. Both approval and denial delete the
browser's authorization session and clear its cookies. Every new request requires sign-in;
the normal admin hostname's session remains independent. Server-captured delegation proof,
current account/policy/factor checks, expiry, revocation and surface generation protect each call.
No refresh token, dynamic client registration or service identity is provided.

Resources and metadata:

| Interface | Resource | Metadata |
| --- | --- | --- |
| MCP | `/api/mcp` | `/.well-known/oauth-protected-resource/api/mcp` |
| CLI | `/api/agent/cli` | `/.well-known/oauth-protected-resource/api/agent/cli` |
| A2A | `/api/a2a` | `/.well-known/oauth-protected-resource/api/a2a` |

Tokens are audience-bound: a CLI token cannot call MCP or A2A. Raw tokens/codes are hashed
in Convex; clients keep the grant in process memory. Authorization-host cookies/sessions cannot
invoke the dashboard or its normal APIs, even by entering a route in the address bar.

## Catalogue and bounded discovery

`packages/backend/convex/platform/agentRegistry.ts` explicitly selects native definitions.
Input JSON schemas derive from their existing Convex validators. Native handlers preserve
business validation, scheduling and audit identity; the native builders and agent entry points
resolve their respective real session/delegation before calling the shared bodies. User/session
adapters use the existing Better Auth component, protected-admin checks and safe result DTOs:
opaque session IDs replace login tokens. Private factor material and token hashes are excluded.
Only selected definitions can execute; there is no arbitrary Convex-function invocation.

`@web-app-starter/agentic/adapter` defines the common `execute(name, input, signal)` boundary.
MCP and WebMCP advertise three stable tools, also used by the CLI/pi adapters:

- `capabilities_search`: up to 15 summaries, 8 by default; empty query pages the catalogue.
- `capabilities_describe`: exact schemas/effects for up to three selected names.
- `capabilities_execute`: validate and execute one capability using `{name, input}`.

The bootstrap schemas stay constant as the catalogue grows. This does not rely on the host
implementing deferred tool exposure. The installed MCP SDK negotiates versions through
2025-11-25; newer protocol discovery features are not assumed. Treat application content as
untrusted data. Destructive operations require the user's explicit intent.

Reads over 12,000 characters return JSON chunks and `nextOffset`. Pass that value as
`resultOffset` to continue. This repeats a read and is not a snapshot; native paginated operations
should use their own cursor. Paging a write is rejected before execution. Native pages and bulk
inputs are capped at 100; inspect descriptions for value conventions. Existing direct
`announcements_*` MCP tool calls now use `capabilities_execute`; their capability names remain.

Credential, biometric, backup-code and invitation-bound enrollment operations are explicit
human workflows returning `requires_user_action` and `executed:false`. Remote live-page
commands return `requires_browser`; use WebMCP on a connected authenticated page. These
outcomes do not claim an operation succeeded. Internal seed/scheduler/proof/audit-write helpers
are implementation details, not administrative activities.

## CLI and pi tester

```sh
# Conversational tester: pi supplies planning and provider credentials.
bun run agent:admin -- --surface mcp --origin http://localhost:3002
bun run agent:admin -- --surface cli --origin http://localhost:3002
bun run agent:admin -- --surface a2a --origin http://localhost:3002
# The old agent:announcements command is an alias.

# Interactive CLI: JSON commands, /auth to renew, /quit to exit.
bun run admin:cli -- --origin http://localhost:3002
# Example command after browser authorization:
# {"operation":"search","input":{"query":"announcements"}}
# {"operation":"describe","input":{"names":["announcements_create"]}}
# {"operation":"execute","input":{"name":"announcements_create","input":{"name":"Draft","bannerText":"Hello"}}}
```

The CLI accepts `--script <JSON file>` containing up to 100 commands. Credentials are neither
script arguments nor saved to disk. Remote write retries must first check application state.
The pi conversation uses `@earendil-works/pi-coding-agent`, its normal configured default model
and credential store; override with `--provider` and `--model`. It has no coding tools, discovered
project instructions, extensions or skills. Conversation and app grants stay in process memory.
`/auth` renews access without discarding conversation. Provider authentication remains separate
from browser admin authorization. Never enter passwords or OTPs into the conversation.
`--prompt` runs one conversational request; `--smoke` performs deterministic announcement CRUD
through the chosen independent transport. `AGENT_NO_OPEN=true` prints the browser link.

## WebMCP

WebMCP is `document.modelContext`, not an HTTP MCP server. A compatible browser registers the
three gateway tools only within the protected normal admin layout. Each call checks current
session/policy/recent proof with a fresh backend request. Disablement, sign-out or leaving the
protected layout removes tools; backend entry points independently reject disabled access.
Unsupported browsers simply register no tools.

Browser capabilities read bounded visible text/controls, activate controls, fill non-secret drafts,
select/toggle values, scroll, reload and navigate protected admin paths. They drive existing UI
handlers and confirmation dialogs. They cannot access credential ceremonies, accept arbitrary
JavaScript/selectors, navigate to public auth pages or silently execute in an unconnected browser.
Controls use opaque IDs from `browser_readPage`; refresh after the page changes. Adding UI that
renders passwords, factor secrets or recovery codes requires `data-agent-sensitive` on the
container **and portal/dialog content**. Application security UI is marked accordingly.

`@web-app-starter/agentic/webmcp` exports a provider interface and reusable `WebMcpSimulator`.
The Playwright provider simulator runs the actual page bindings, session checks, CRUD and
controls without granting authentication or pretending the browser supports the experimental API.

## A2A worker

The public card is `/.well-known/agent-card.json`, available only while A2A is enabled. The
released **A2A 1.0.0** JSON-RPC binding uses `A2A-Version: 1.0` and PascalCase methods:
`SendMessage`, `GetTask`, `ListTasks`, `CancelTask`. Missing/unsupported versions are rejected.
Streaming, push callbacks and extended cards are explicitly unsupported and advertised false.
The worker executes structured commands; pi or another caller supplies conversational planning.
It does not run a server-side LLM.

```json
{
  "jsonrpc": "2.0",
  "id": "request-1",
  "method": "SendMessage",
  "params": {
    "message": {
      "messageId": "unique-message-1",
      "role": "ROLE_USER",
      "parts": [{"data": {"operation": "search", "input": {"query": "users"}}, "mediaType": "application/json"}]
    },
    "configuration": {"returnImmediately": true, "historyLength": 0}
  }
}
```

Text-only messages return `TASK_STATE_INPUT_REQUIRED` with structured-command guidance.
Continuation must reference an owned nonterminal input-required task with matching context.
Message IDs deduplicate retries; changing a reused message's command is rejected. Jobs persist
in Convex and store grant IDs, never raw credentials. Every execution rechecks the live grant,
surface generation and current policy; queued writes also recheck recent verification. Native
writes and task completion commit atomically. A watchdog retries interrupted workers; duplicate
delivery cannot repeat a committed operation. Canceling before commit prevents execution;
completed operations cannot be canceled or undone through `CancelTask`.

Task results are owned by the authorizing user and retained for 24 hours, with a maximum of 200
unexpired tasks per user and 12 messages per task. Listings default to 50 entries and omit
artifacts; artifact-inclusive pages are capped at three. Polling/continuation requires a valid
A2A grant. `SendMessage` waits for a terminal/interrupted state unless `returnImmediately` is
true; a server timeout reports the task ID so clients can inspect it before retrying.

## Reusable acceptance

```sh
bun run agent:simulator -- --surface mcp --origin http://localhost:3002
bun run agent:simulator -- --surface cli --origin http://localhost:3002
bun run agent:simulator -- --surface a2a --origin http://localhost:3002
# --read-only skips disposable draft CRUD; --output summary.json writes sanitized measurements.
CI=true E2E_BASE_URL=http://localhost:3002 AGENT_MCP_ENABLED=true \
  bun run --cwd platform/apps/admin test:e2e agentic-mcp.spec.ts agentic-surfaces.spec.ts
bun run --cwd packages/backend test:convex agentAccess endpoint-authorization
bun run --cwd platform/packages/agentic test
```

The simulator checks every discoverable schema, representative reads, disposable draft CRUD,
bootstrap size and request latency. Its report contains no application data or credentials.
Browser tests cover actual OAuth/one-use consent/PKCE, audience/disable controls, native CRUD,
A2A lifecycle and WebMCP registration/page bindings. Unit/backend tests cover policy changes,
expiry, replay, schema bounds, protected identities, safe results and durable task behavior.
Run these against a disposable local deployment; email/invitation workflows use the configured
provider and their delivery remains asynchronous.
