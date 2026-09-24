import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { internal } from "./_generated/api";
import schema from "./schema";
import { sendAuthEmail } from "./sendAuthEmail";

const modules = import.meta.glob("./**/*.*s");
const recipient = "recipient@example.test";
const sender = "sender@example.test";
type Message = { from: string; to: string; subject: string; html: string; text: string };
type CapturedRequest = { method?: string; url?: string; authorization?: string; body: Message };

// Simulated local HTTP transport, with the real Resend SDK and real callers.
// This verifies API construction/error handling, not external email delivery.
describe("Resend email transport", () => {
  let server: Server;
  let requests: CapturedRequest[];
  let responseMode: "success" | "rejected" | "disconnected";

  beforeEach(async () => {
    requests = [];
    responseMode = "success";
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      requests.push({
        method: req.method, url: req.url, authorization: req.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString()) as Message,
      });
      if (responseMode === "disconnected") {
        req.socket.destroy();
        return;
      }
      res.writeHead(responseMode === "rejected" ? 422 : 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(responseMode === "rejected"
        ? { name: "validation_error", message: "Simulated sender rejected", statusCode: 422 }
        : { id: "simulated-email-id" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    vi.stubEnv("RESEND_BASE_URL", `http://127.0.0.1:${address.port}`);
    vi.stubEnv("RESEND_API_KEY", "re_local_fake_key");
    vi.stubEnv("EMAIL_FROM", sender);
    vi.stubEnv("SITE_URL", "https://web.example.test,https://other.example.test");
    vi.stubEnv("ADMIN_SITE_URL", "https://admin.example.test");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function sentMessage(): Message {
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: "POST", url: "/emails", authorization: "Bearer re_local_fake_key",
      body: { from: sender, to: recipient },
    });
    return requests[0].body;
  }

  async function prepareCaller(kind: "auth" | "admin" | "waitlist") {
    const t = convexTest(schema, modules);
    if (kind === "auth") {
      return {
        send: () => sendAuthEmail({ to: recipient, type: "verification", urlOrCode: "https://web.example.test/verify?token=local" }),
        verify: async (message: Message) => {
          expect(message.subject).toBe("Verify your email address");
          expect(message.html).toContain("https://web.example.test/verify?token=local");
          expect(message.text).toContain("https://web.example.test/verify?token=local");
        },
      };
    }
    const now = Date.now();
    const adminId = kind === "admin" ? await t.run((ctx) => ctx.db.insert("adminInvitations", {
      email: recipient, status: "invited", invitedAt: now, createdAt: now,
    })) : undefined;
    const entryId = kind === "waitlist" ? await t.run((ctx) => ctx.db.insert("waitlistEntries", {
      email: recipient, status: "invited", meta: "{}", createdAt: now,
    })) : undefined;
    return {
      send: () => adminId
        ? t.action(internal.adminInvitationActions.generateTokenAndSendEmail, { adminInvitationId: adminId, email: recipient })
        : t.action(internal.waitlistActions.generateTokenAndSendEmail, { entryId: entryId!, email: recipient }),
      verify: async (message: Message) => {
        const link = message.text.match(/https:\/\/\S+\?token=([a-f0-9]{64})/);
        expect(link).not.toBeNull();
        const url = new URL(link![0]);
        expect(url.origin).toBe(kind === "admin" ? "https://admin.example.test" : "https://web.example.test");
        expect(url.pathname).toBe(kind === "admin" ? "/onboarding" : "/signup-with-invitation");
        expect(message.html).toContain(url.href);
        expect(message.subject.length).toBeGreaterThan(0);
        const stored = await t.run(async (ctx) => adminId
          ? await ctx.db.get(adminId)
          : await ctx.db.query("invitationTokens").unique());
        expect(stored?.token).toBe(createHash("sha256").update(link![1]).digest("hex"));
      },
    };
  }

  for (const kind of ["auth", "admin", "waitlist"] as const) {
    test(`${kind} constructs an email accepted by simulated transport`, async () => {
      const caller = await prepareCaller(kind);
      await caller.send();
      await caller.verify(sentMessage());
    });

    for (const mode of ["rejected", "disconnected"] as const) {
      test(`${kind} propagates ${mode} transport failure`, async () => {
        responseMode = mode;
        const caller = await prepareCaller(kind);
        await expect(caller.send()).rejects.toThrow(mode === "rejected"
          ? "Simulated sender rejected" : "Unable to fetch data");
        sentMessage();
      });
    }
  }

  for (const type of ["reset-password", "magic-link", "email-otp"] as const) {
    test(`${type} includes the requested link or code`, async () => {
      const value = type === "email-otp" ? "123456" : "https://web.example.test/auth?token=local";
      await sendAuthEmail({ to: recipient, type, urlOrCode: value });
      const message = sentMessage();
      expect(message.text).toContain(value);
      expect(message.html).toContain(value);
    });
  }

  test("custom auth email preserves supplied content", async () => {
    const content = { subject: "Invitation", html: "<p>Local invitation</p>", text: "Local invitation" };
    await sendAuthEmail({ to: recipient, type: "custom", ...content });
    expect(sentMessage()).toMatchObject(content);
  });
});
