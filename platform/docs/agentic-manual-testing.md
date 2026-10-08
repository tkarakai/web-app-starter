# Admin agentic surfaces: manual end-to-end testing

The instructions below preserve the original walkthrough. Substitute your own product checkout
for the local path in the first command.

Use the existing local dev deployment. **There is no separate authorization server to start**—the admin and authorization hostnames use the same process.

**1. Start the app**

Run from the product directory:

```sh
cd <product-checkout>
nvm use 24.21.0
bun install --frozen-lockfile
bun run setup:e2e
AGENT_MCP_ENABLED=true bun run dev:admin
```

`setup:e2e` installs the browser binaries; you only need it initially or after browser dependency updates.

Open **http://localhost:3002**, sign in as an admin, and enable all four switches under **Configure → Features**:

- MCP server
- Admin CLI
- WebMCP
- A2A

Use the actual port printed by the launcher if it differs from `3002`. Run the following commands in another terminal, from the same product directory.

**2. MCP: test the conversational agent**

```sh
bun run agent:admin -- --surface mcp --origin http://localhost:3002
```

The browser opens the authorization hostname. Sign in, complete any verification, and approve **Authorize admin agent**.

Give pi these requests separately, checking the **Announcements** page after each:

1. “Create an unscheduled announcement draft named MCP E2E with banner text Hello. Read it back.”
2. “Update that draft’s banner text to Updated through MCP. Read it back.”
3. “Permanently delete only the MCP E2E draft, then verify it is gone.”

Then try:

> Discover the available administration capabilities. Read the current MFA policy and list the first five users without changing anything.

Expected: discovery exposes three gateway tools, with capabilities discovered through them. The announcement changes should appear in the normal admin UI.

Use `/auth` to renew application authorization and `/quit` to exit. Pi’s model-provider login is separate from application authorization.

**3. CLI: test both conversational and direct commands**

For the same conversational exercise over the CLI transport:

```sh
bun run agent:admin -- --surface cli --origin http://localhost:3002
```

Repeat the three announcement requests above using the name **CLI E2E**.

For direct commands without an LLM:

```sh
bun run admin:cli -- --origin http://localhost:3002
```

After browser authorization, enter one JSON command per line:

```json
{"operation":"search","input":{"query":"announcements"}}
{"operation":"describe","input":{"names":["announcements_create"]}}
{"operation":"execute","input":{"name":"announcements_create","input":{"name":"CLI direct E2E","bannerText":"Hello"}}}
```

Copy the returned announcement `id`, then substitute it below:

```json
{"operation":"execute","input":{"name":"announcements_get","input":{"announcementId":"<ID>"}}}
{"operation":"execute","input":{"name":"announcements_update","input":{"announcementId":"<ID>","patch":{"bannerText":"Updated"}}}}
{"operation":"execute","input":{"name":"announcements_delete","input":{"announcementId":"<ID>"}}}
{"operation":"execute","input":{"name":"announcements_get","input":{"announcementId":"<ID>"}}}
```

Expected: the update persists, and the final read returns `null`.

**4. A2A: test the conversational agent and task transport**

First open the agent card:

**http://localhost:3002/.well-known/agent-card.json**

It should return the enabled service’s metadata.

Then run:

```sh
bun run agent:admin -- --surface a2a --origin http://localhost:3002
```

Authorize and repeat the announcement exercise using **A2A E2E**. This performs the operations through durable A2A tasks. You can also ask:

> List my recent agent tasks and inspect the completed announcement task.

The automated tests below additionally exercise protocol-version checks and task controls.

**5. WebMCP: test the real browser interface**

WebMCP uses the logged-in admin browser session. It does not use the remote pi tester or open a separate authorization dialog.

Run the native browser test visibly:

```sh
CI=true E2E_BASE_URL=http://localhost:3002 \
bun run --cwd platform/apps/admin test:e2e -- \
  agentic-webmcp-native.spec.ts --workers=1 --headed
```

This launches Chromium with WebMCP enabled, signs in, verifies tool registration, performs announcement CRUD, and checks that disabling WebMCP removes the tools.

Expected: **1 passed**. A **skipped** result means that the installed browser lacks the experimental API; it does not establish native WebMCP success.

To watch the browser-control tests as well:

```sh
CI=true E2E_BASE_URL=http://localhost:3002 \
bun run --cwd platform/apps/admin test:e2e -- \
  agentic-surfaces.spec.ts --grep "WebMCP provider simulator" \
  --workers=1 --headed
```

This exercises the real authenticated page bindings, including navigation, reading controls, opening the announcement editor, filling a draft, and rejecting navigation to authentication pages.

**6. Run the independent transport simulators**

These need application authorization but **no LLM credentials**:

```sh
bun run agent:simulator -- --surface mcp --origin http://localhost:3002
bun run agent:simulator -- --surface cli --origin http://localhost:3002
bun run agent:simulator -- --surface a2a --origin http://localhost:3002
```

Run them sequentially and authorize each.

Expected: all entries selected by [the native registry](../../packages/backend/convex/platform/agentRegistry.ts) and [browser catalogue](../packages/agentic/src/browser-catalogue.ts), valid schemas, successful representative reads, and `disposableDraftCleaned: true`. Add `--output mcp-summary.json`, for example, to save measurements.

These enumerate the whole catalogue; they exercise representative reads and disposable announcement CRUD rather than executing every destructive administration operation.

**7. Check authorization and feature controls manually**

For each remote interface—MCP, CLI, and A2A:

1. Start it and **deny** authorization. It must obtain no access.
2. Start it again. It must require a fresh sign-in.
3. Approve it, then revoke its grant at **Settings → Agent grants**. Subsequent requests must fail.
4. Authorize again, then disable its switch under **Configure → Features**. Requests must fail while other enabled interfaces continue working.
5. Re-enable it. The old grant must remain invalid; use `/auth` for fresh authorization.

Also check:

- Logging into the normal admin hostname does not invalidate the agent grant.
- Entering an admin dashboard route on `mcp-auth.localhost:3002` cannot open the dashboard.
- Approval and denial both end the authorization-host browser session.
- After five minutes, remote writes require renewed verification through `/auth`.

**8. Run the complete automated agentic suite**

Use a local development deployment: these tests create disposable accounts and change the deployment’s feature switches. Re-enable your desired switches afterward.

```sh
CI=true \
E2E_BASE_URL=http://localhost:3002 \
AGENT_MCP_ENABLED=true \
AGENT_SIMULATORS=true \
AGENT_LLM_SMOKE=true \
AGENT_EVIDENCE_DIR=/tmp/admin-agent-evidence \
bun run --cwd platform/apps/admin test:e2e -- \
  agentic-mcp.spec.ts \
  agentic-surfaces.spec.ts \
  agentic-webmcp-native.spec.ts \
  agentic-testers.spec.ts \
  --workers=1
```

Expected with a supported browser and valid model credentials: **11 tests passed**.

The real pi tests default to **`openai-codex / gpt-6.1-sol`**. Set `AGENT_TEST_PROVIDER` and `AGENT_TEST_MODEL` to use another configured provider/model. Set `AGENT_LLM_SMOKE=false` to skip model-backed tests while retaining deterministic acceptance.

Sanitized client reports go into `/tmp/admin-agent-evidence`; the browser report is under `platform/apps/admin/qa/playwright-report`.

When finished:

```sh
bun run dev:stop
bun run dev:status
```

The maintained reference is [the agentic surfaces guide](agentic-announcements.md).
