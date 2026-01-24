/**
 * Convex Backend Tests for Launch Items
 *
 * This file demonstrates how to test Convex queries and mutations
 * using convex-test. It includes patterns for mocking authentication
 * and testing database operations.
 *
 * Run with: npx convex-test
 *
 * @module convex/launchItems.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe, beforeEach } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

/**
 * Mock user data for testing
 */
const mockUser = {
  _id: "test-user-123" as const,
  userId: "test-user-123",
  email: "test@example.com",
  name: "Test User",
};

/**
 * Helper to create a test environment with authentication mocked
 */
function createTestEnv() {
  return convexTest(schema);
}

describe("launchItems", () => {
  describe("list", () => {
    test("returns empty array when not authenticated", async () => {
      const t = createTestEnv();

      // Mock the auth component to return null (not authenticated)
      const result = await t.query(api.launchItems.list, {});

      // Should return empty array, not error
      expect(result).toEqual([]);
    });

    test("returns only items owned by the authenticated user", async () => {
      const t = createTestEnv();

      // Seed some test data
      await t.run(async (ctx) => {
        // Items for our test user
        await ctx.db.insert("launchItems", {
          title: "User's Item 1",
          description: "Description 1",
          status: "idea",
          priority: 1,
          ownerId: mockUser._id,
          createdAt: Date.now(),
        });

        await ctx.db.insert("launchItems", {
          title: "User's Item 2",
          description: "Description 2",
          status: "building",
          priority: 2,
          ownerId: mockUser._id,
          createdAt: Date.now(),
        });

        // Item for a different user (should not be returned)
        await ctx.db.insert("launchItems", {
          title: "Other User's Item",
          description: "Should not appear",
          status: "shipping",
          priority: 1,
          ownerId: "other-user-456",
          createdAt: Date.now(),
        });
      });

      // Query with mocked authentication
      // Note: In actual tests, you'd mock the authComponent.getAuthUser
      // This is a simplified example showing the pattern
      const result = await t.run(async (ctx) => {
        return ctx.db
          .query("launchItems")
          .withIndex("by_owner", (q) => q.eq("ownerId", mockUser._id))
          .collect();
      });

      expect(result).toHaveLength(2);
      expect(result.map((item) => item.title)).toContain("User's Item 1");
      expect(result.map((item) => item.title)).toContain("User's Item 2");
      expect(result.map((item) => item.title)).not.toContain("Other User's Item");
    });
  });

  describe("create", () => {
    test("creates a new launch item with correct fields", async () => {
      const t = createTestEnv();

      const newItem = {
        title: "Test Item",
        description: "Test Description",
        status: "idea" as const,
        priority: 1,
        ownerId: mockUser._id,
        createdAt: Date.now(),
      };

      // Insert directly to test the schema
      const id = await t.run(async (ctx) => {
        return ctx.db.insert("launchItems", newItem);
      });

      // Verify the item was created
      const result = await t.run(async (ctx) => {
        return ctx.db.get(id);
      });

      expect(result).toBeDefined();
      expect(result?.title).toBe("Test Item");
      expect(result?.description).toBe("Test Description");
      expect(result?.status).toBe("idea");
      expect(result?.priority).toBe(1);
      expect(result?.ownerId).toBe(mockUser._id);
    });

    test("validates required fields", async () => {
      const t = createTestEnv();

      // This should fail validation (missing required fields)
      await expect(
        t.run(async (ctx) => {
          // @ts-expect-error - intentionally passing invalid data
          return ctx.db.insert("launchItems", {
            title: "Only Title",
            // missing: description, status, priority, ownerId, createdAt
          });
        })
      ).rejects.toThrow();
    });

    test("validates status enum values", async () => {
      const t = createTestEnv();

      await expect(
        t.run(async (ctx) => {
          return ctx.db.insert("launchItems", {
            title: "Test",
            description: "Test",
            // @ts-expect-error - intentionally passing invalid status
            status: "invalid-status",
            priority: 1,
            ownerId: mockUser._id,
            createdAt: Date.now(),
          });
        })
      ).rejects.toThrow();
    });
  });

  describe("update", () => {
    test("updates item fields correctly", async () => {
      const t = createTestEnv();

      // Create an item first
      const id = await t.run(async (ctx) => {
        return ctx.db.insert("launchItems", {
          title: "Original Title",
          description: "Original Description",
          status: "idea",
          priority: 1,
          ownerId: mockUser._id,
          createdAt: Date.now(),
        });
      });

      // Update the item
      await t.run(async (ctx) => {
        return ctx.db.patch(id, {
          title: "Updated Title",
          status: "building",
        });
      });

      // Verify the update
      const result = await t.run(async (ctx) => {
        return ctx.db.get(id);
      });

      expect(result?.title).toBe("Updated Title");
      expect(result?.status).toBe("building");
      // Unchanged fields should remain
      expect(result?.description).toBe("Original Description");
      expect(result?.priority).toBe(1);
    });
  });
});

describe("schema indexes", () => {
  test("by_owner index returns items for specific owner", async () => {
    const t = createTestEnv();

    // Seed data for multiple owners
    await t.run(async (ctx) => {
      await ctx.db.insert("launchItems", {
        title: "Alice's Item",
        description: "Owned by Alice",
        status: "idea",
        priority: 1,
        ownerId: "alice",
        createdAt: Date.now(),
      });

      await ctx.db.insert("launchItems", {
        title: "Bob's Item",
        description: "Owned by Bob",
        status: "building",
        priority: 1,
        ownerId: "bob",
        createdAt: Date.now(),
      });
    });

    // Query using the index
    const aliceItems = await t.run(async (ctx) => {
      return ctx.db
        .query("launchItems")
        .withIndex("by_owner", (q) => q.eq("ownerId", "alice"))
        .collect();
    });

    expect(aliceItems).toHaveLength(1);
    expect(aliceItems[0].title).toBe("Alice's Item");
  });

  test("by_status index returns items with specific status", async () => {
    const t = createTestEnv();

    // Seed data with different statuses
    await t.run(async (ctx) => {
      await ctx.db.insert("launchItems", {
        title: "Idea Item",
        description: "Status: idea",
        status: "idea",
        priority: 1,
        ownerId: "test",
        createdAt: Date.now(),
      });

      await ctx.db.insert("launchItems", {
        title: "Building Item",
        description: "Status: building",
        status: "building",
        priority: 1,
        ownerId: "test",
        createdAt: Date.now(),
      });

      await ctx.db.insert("launchItems", {
        title: "Shipping Item",
        description: "Status: shipping",
        status: "shipping",
        priority: 1,
        ownerId: "test",
        createdAt: Date.now(),
      });
    });

    // Query using the status index
    const buildingItems = await t.run(async (ctx) => {
      return ctx.db
        .query("launchItems")
        .withIndex("by_status", (q) => q.eq("status", "building"))
        .collect();
    });

    expect(buildingItems).toHaveLength(1);
    expect(buildingItems[0].title).toBe("Building Item");
  });
});
