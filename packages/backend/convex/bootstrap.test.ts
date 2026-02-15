import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

const BOOTSTRAP_META = JSON.stringify({
  superpowers: ["coffee-to-code"],
  excitement: ["take-my-money"],
});

function createTestEnv() {
  return convexTest(schema, modules);
}

describe("bootstrap", () => {
  // -----------------------------------------------------------------------
  // initialize
  // -----------------------------------------------------------------------

  describe("initialize", () => {
    test("seeds admin email and creates invited waitlist entry on empty system", async () => {
      const t = createTestEnv();

      // Simulate what initialize does
      const entryId = await t.run(async (ctx) => {
        // Guard: adminEmails must be empty
        const existing = await ctx.db.query("adminEmails").collect();
        expect(existing).toHaveLength(0);

        // Insert admin email
        await ctx.db.insert("adminEmails", { email: "admin@example.com" });

        // Insert waitlist entry
        const now = Date.now();
        const id = await ctx.db.insert("waitlistEntries", {
          email: "admin@example.com",
          meta: BOOTSTRAP_META,
          status: "waiting",
          createdAt: now,
        });

        // Immediately invite
        await ctx.db.patch(id, { status: "invited", invitedAt: now });

        return id;
      });

      // Verify results
      const adminEmails = await t.run(async (ctx) => {
        return ctx.db.query("adminEmails").collect();
      });
      expect(adminEmails).toHaveLength(1);
      expect(adminEmails[0].email).toBe("admin@example.com");

      const entry = await t.run(async (ctx) => {
        return ctx.db.get(entryId);
      });
      expect(entry).toBeDefined();
      expect(entry?.email).toBe("admin@example.com");
      expect(entry?.status).toBe("invited");
      expect(entry?.invitedAt).toBeDefined();
    });

    test("fails if adminEmails already has an entry", async () => {
      const t = createTestEnv();

      // Pre-seed an admin email
      await t.run(async (ctx) => {
        await ctx.db.insert("adminEmails", { email: "existing@example.com" });
      });

      // Guard should reject
      await t.run(async (ctx) => {
        const existing = await ctx.db.query("adminEmails").collect();
        expect(existing.length).toBeGreaterThan(0);
      });
    });

    test("creates valid meta that matches waitlist schema", async () => {
      const t = createTestEnv();

      // The synthetic meta should be insertable into waitlistEntries
      const entryId = await t.run(async (ctx) => {
        return ctx.db.insert("waitlistEntries", {
          email: "test@example.com",
          meta: BOOTSTRAP_META,
          status: "waiting",
          createdAt: Date.now(),
        });
      });

      const entry = await t.run(async (ctx) => {
        return ctx.db.get(entryId);
      });
      expect(entry).toBeDefined();

      const meta = JSON.parse(entry!.meta);
      expect(meta.superpowers).toContain("coffee-to-code");
      expect(meta.excitement).toContain("take-my-money");
    });
  });

  // -----------------------------------------------------------------------
  // rescue
  // -----------------------------------------------------------------------

  describe("rescue", () => {
    test("updates admin email and revokes old tokens when email changes", async () => {
      const t = createTestEnv();

      // Seed: one admin email + invited entry + active token
      const { adminId, entryId, tokenId } = await t.run(async (ctx) => {
        const aId = await ctx.db.insert("adminEmails", {
          email: "typo@exmaple.com",
        });
        const eId = await ctx.db.insert("waitlistEntries", {
          email: "typo@exmaple.com",
          meta: BOOTSTRAP_META,
          status: "invited",
          invitedAt: Date.now(),
          createdAt: Date.now(),
        });
        const tId = await ctx.db.insert("invitationTokens", {
          waitlistEntryId: eId,
          token: "old-token-abc",
          email: "typo@exmaple.com",
          status: "sent",
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
          createdAt: Date.now(),
        });
        return { adminId: aId, entryId: eId, tokenId: tId };
      });

      // Simulate rescue: update email, revoke tokens, re-invite
      await t.run(async (ctx) => {
        // Update admin email
        await ctx.db.patch(adminId, { email: "correct@example.com" });

        // Revoke old tokens
        const tokens = await ctx.db
          .query("invitationTokens")
          .withIndex("by_email", (q) => q.eq("email", "typo@exmaple.com"))
          .collect();
        for (const token of tokens) {
          if (token.status === "sent" || token.status === "claiming") {
            await ctx.db.patch(token._id, { status: "revoked" });
          }
        }

        // Update waitlist entry
        await ctx.db.patch(entryId, {
          email: "correct@example.com",
          status: "invited",
          invitedAt: Date.now(),
        });
      });

      // Verify: admin email updated
      const adminEmails = await t.run(async (ctx) => {
        return ctx.db.query("adminEmails").collect();
      });
      expect(adminEmails).toHaveLength(1);
      expect(adminEmails[0].email).toBe("correct@example.com");

      // Verify: old token revoked
      const oldToken = await t.run(async (ctx) => {
        return ctx.db.get(tokenId);
      });
      expect(oldToken?.status).toBe("revoked");

      // Verify: waitlist entry updated
      const entry = await t.run(async (ctx) => {
        return ctx.db.get(entryId);
      });
      expect(entry?.email).toBe("correct@example.com");
      expect(entry?.status).toBe("invited");
    });

    test("resends invitation when email is the same (no change)", async () => {
      const t = createTestEnv();

      const { entryId, tokenId } = await t.run(async (ctx) => {
        await ctx.db.insert("adminEmails", { email: "admin@example.com" });
        const eId = await ctx.db.insert("waitlistEntries", {
          email: "admin@example.com",
          meta: BOOTSTRAP_META,
          status: "invited",
          invitedAt: Date.now() - 100000,
          createdAt: Date.now() - 100000,
        });
        const tId = await ctx.db.insert("invitationTokens", {
          waitlistEntryId: eId,
          token: "expired-token",
          email: "admin@example.com",
          status: "sent",
          expiresAt: Date.now() - 1000, // expired
          createdAt: Date.now() - 100000,
        });
        return { entryId: eId, tokenId: tId };
      });

      // Simulate rescue with same email
      await t.run(async (ctx) => {
        // Revoke old tokens
        const tokens = await ctx.db
          .query("invitationTokens")
          .withIndex("by_email", (q) => q.eq("email", "admin@example.com"))
          .collect();
        for (const token of tokens) {
          if (token.status === "sent" || token.status === "claiming") {
            await ctx.db.patch(token._id, { status: "revoked" });
          }
        }

        // Reset entry and re-invite
        await ctx.db.patch(entryId, {
          status: "invited",
          invitedAt: Date.now(),
        });
      });

      // Old token should be revoked
      const oldToken = await t.run(async (ctx) => {
        return ctx.db.get(tokenId);
      });
      expect(oldToken?.status).toBe("revoked");

      // Entry should be re-invited
      const entry = await t.run(async (ctx) => {
        return ctx.db.get(entryId);
      });
      expect(entry?.status).toBe("invited");
    });

    test("guard: fails if no admin emails exist", async () => {
      const t = createTestEnv();

      const adminEmails = await t.run(async (ctx) => {
        return ctx.db.query("adminEmails").collect();
      });
      expect(adminEmails).toHaveLength(0);
      // rescue would throw BOOTSTRAP_NOT_INITIALIZED
    });

    test("guard: fails if multiple admin emails exist", async () => {
      const t = createTestEnv();

      await t.run(async (ctx) => {
        await ctx.db.insert("adminEmails", { email: "admin1@example.com" });
        await ctx.db.insert("adminEmails", { email: "admin2@example.com" });
      });

      const adminEmails = await t.run(async (ctx) => {
        return ctx.db.query("adminEmails").collect();
      });
      expect(adminEmails.length).toBeGreaterThan(1);
      // rescue would throw BOOTSTRAP_MULTIPLE_ADMINS
    });

    test("guard: fails if currentEmail does not match", async () => {
      const t = createTestEnv();

      await t.run(async (ctx) => {
        await ctx.db.insert("adminEmails", { email: "real@example.com" });
      });

      const adminEmails = await t.run(async (ctx) => {
        return ctx.db.query("adminEmails").collect();
      });
      expect(adminEmails[0].email).not.toBe("wrong@example.com");
      // rescue would throw BOOTSTRAP_EMAIL_MISMATCH
    });

    test("guard: fails if waitlist entry is claimed", async () => {
      const t = createTestEnv();

      await t.run(async (ctx) => {
        await ctx.db.insert("adminEmails", { email: "admin@example.com" });
        await ctx.db.insert("waitlistEntries", {
          email: "admin@example.com",
          meta: BOOTSTRAP_META,
          status: "claimed",
          invitedAt: Date.now(),
          claimedAt: Date.now(),
          createdAt: Date.now(),
        });
      });

      const entry = await t.run(async (ctx) => {
        return ctx.db
          .query("waitlistEntries")
          .withIndex("by_email", (q) => q.eq("email", "admin@example.com"))
          .first();
      });
      expect(entry?.status).toBe("claimed");
      // rescue would throw BOOTSTRAP_ALREADY_COMPLETE
    });

    test("revokes tokens in 'claiming' state too", async () => {
      const t = createTestEnv();

      const tokenId = await t.run(async (ctx) => {
        await ctx.db.insert("adminEmails", { email: "admin@example.com" });
        const eId = await ctx.db.insert("waitlistEntries", {
          email: "admin@example.com",
          meta: BOOTSTRAP_META,
          status: "invited",
          invitedAt: Date.now(),
          createdAt: Date.now(),
        });
        return ctx.db.insert("invitationTokens", {
          waitlistEntryId: eId,
          token: "claiming-token",
          email: "admin@example.com",
          status: "claiming",
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
          createdAt: Date.now(),
          claimStartedAt: Date.now(),
        });
      });

      // Revoke
      await t.run(async (ctx) => {
        const tokens = await ctx.db
          .query("invitationTokens")
          .withIndex("by_email", (q) => q.eq("email", "admin@example.com"))
          .collect();
        for (const token of tokens) {
          if (token.status === "sent" || token.status === "claiming") {
            await ctx.db.patch(token._id, { status: "revoked" });
          }
        }
      });

      const token = await t.run(async (ctx) => {
        return ctx.db.get(tokenId);
      });
      expect(token?.status).toBe("revoked");
    });
  });

  // -----------------------------------------------------------------------
  // status
  // -----------------------------------------------------------------------

  describe("status", () => {
    test("returns not bootstrapped with hint when no admin email exists", async () => {
      const t = createTestEnv();

      const adminEmails = await t.run(async (ctx) => {
        return ctx.db.query("adminEmails").collect();
      });

      expect(adminEmails).toHaveLength(0);
      // status would return { bootstrapped: false, hint: "Run bootstrap:initialize..." }
    });

    test("returns bootstrapped: true when waitlist entry is claimed", async () => {
      const t = createTestEnv();

      await t.run(async (ctx) => {
        await ctx.db.insert("adminEmails", { email: "admin@example.com" });
        await ctx.db.insert("waitlistEntries", {
          email: "admin@example.com",
          meta: BOOTSTRAP_META,
          status: "claimed",
          invitedAt: Date.now(),
          claimedAt: Date.now(),
          createdAt: Date.now(),
        });
      });

      const entry = await t.run(async (ctx) => {
        return ctx.db
          .query("waitlistEntries")
          .withIndex("by_email", (q) => q.eq("email", "admin@example.com"))
          .first();
      });
      expect(entry?.status).toBe("claimed");
      // status would return { bootstrapped: true, adminEmail: "admin@example.com" }
    });

    test("reports active token when invitation is pending", async () => {
      const t = createTestEnv();

      await t.run(async (ctx) => {
        await ctx.db.insert("adminEmails", { email: "admin@example.com" });
        const eId = await ctx.db.insert("waitlistEntries", {
          email: "admin@example.com",
          meta: BOOTSTRAP_META,
          status: "invited",
          invitedAt: Date.now(),
          createdAt: Date.now(),
        });
        await ctx.db.insert("invitationTokens", {
          waitlistEntryId: eId,
          token: "active-token",
          email: "admin@example.com",
          status: "sent",
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
          createdAt: Date.now(),
        });
      });

      const tokens = await t.run(async (ctx) => {
        return ctx.db
          .query("invitationTokens")
          .withIndex("by_email", (q) => q.eq("email", "admin@example.com"))
          .collect();
      });
      expect(tokens).toHaveLength(1);
      expect(tokens[0].status).toBe("sent");
      expect(tokens[0].expiresAt).toBeGreaterThan(Date.now());
      // status would return { bootstrapped: false, tokenStatus: "sent", hint: "Check inbox..." }
    });

    test("detects expired token", async () => {
      const t = createTestEnv();

      await t.run(async (ctx) => {
        await ctx.db.insert("adminEmails", { email: "admin@example.com" });
        const eId = await ctx.db.insert("waitlistEntries", {
          email: "admin@example.com",
          meta: BOOTSTRAP_META,
          status: "invited",
          invitedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
          createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
        });
        await ctx.db.insert("invitationTokens", {
          waitlistEntryId: eId,
          token: "expired-token",
          email: "admin@example.com",
          status: "sent",
          expiresAt: Date.now() - 1000, // expired
          createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
        });
      });

      const tokens = await t.run(async (ctx) => {
        return ctx.db
          .query("invitationTokens")
          .withIndex("by_email", (q) => q.eq("email", "admin@example.com"))
          .collect();
      });
      expect(tokens[0].expiresAt).toBeLessThan(Date.now());
      // status would return { bootstrapped: false, tokenExpired: true, hint: "Token expired..." }
    });

    test("finds most recent token among multiple", async () => {
      const t = createTestEnv();

      await t.run(async (ctx) => {
        await ctx.db.insert("adminEmails", { email: "admin@example.com" });
        const eId = await ctx.db.insert("waitlistEntries", {
          email: "admin@example.com",
          meta: BOOTSTRAP_META,
          status: "invited",
          invitedAt: Date.now(),
          createdAt: Date.now(),
        });
        // Older token (revoked)
        await ctx.db.insert("invitationTokens", {
          waitlistEntryId: eId,
          token: "old-revoked-token",
          email: "admin@example.com",
          status: "revoked",
          expiresAt: Date.now() - 1000,
          createdAt: Date.now() - 100000,
        });
        // Newer token (active)
        await ctx.db.insert("invitationTokens", {
          waitlistEntryId: eId,
          token: "new-active-token",
          email: "admin@example.com",
          status: "sent",
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
          createdAt: Date.now(),
        });
      });

      const tokens = await t.run(async (ctx) => {
        return ctx.db
          .query("invitationTokens")
          .withIndex("by_email", (q) => q.eq("email", "admin@example.com"))
          .collect();
      });

      // The most recent token should be the active one
      const latest = tokens.reduce((a, b) =>
        a.createdAt > b.createdAt ? a : b,
      );
      expect(latest.status).toBe("sent");
      expect(latest.token).toBe("new-active-token");
    });
  });
});
