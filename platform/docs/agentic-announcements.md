# Announcement MCP POC

This opt-in service adds five tools (`announcements_list`, `announcements_get`,
`announcements_create`, `announcements_update`, `announcements_delete`) on the admin app's
`POST /api/mcp` endpoint. UI APIs remain native Convex functions. Native handlers retain
validation, scheduling, audit identity and storage; MCP adds no separate business database.

## Authentication

The only registered client is `pi-announcements`, a public local test client. It opens the
admin browser's `/settings/agent-access` page for sign-in, current security checks and explicit
consent. The redirect must use `http://127.0.0.1:<port>/callback`. Authorization-code exchange
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
missing configuration fails closed. The default configured admin origin is `http://localhost:3001`;
use the actual configured port. Never set a cloud deployment key for the local dev harness.

## Adapter boundary

`@web-app-starter/agentic/catalogue` exports input schemas and descriptions; `/adapter` defines
`CapabilityAdapter.execute`. The admin Convex adapter validates inputs and calls grant-aware
native entry points. These entry points resolve grants and current policy inside the same
backend transaction as each write. Future surfaces can use the adapter without introducing a
new action engine or flattening Convex queries and mutations. Authentication credentials are
host context and are absent from tool input schemas and model context.
