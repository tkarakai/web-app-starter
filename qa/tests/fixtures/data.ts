/**
 * Test Fixtures for Database Seeding
 *
 * This module provides type-safe test data fixtures for use in tests.
 * These fixtures can be used with convex-test for backend testing
 * or for mocking data in component tests.
 *
 * @module tests/fixtures/data
 */

/**
 * LaunchItem fixture type matching convex/schema.ts
 */
export interface LaunchItemFixture {
  title: string;
  description: string;
  status: "idea" | "building" | "shipping";
  priority: number;
  ownerId: string;
  createdAt: number;
}

/**
 * Upload fixture type matching convex/schema.ts
 */
export interface UploadFixture {
  storageId: string;
  name: string;
  contentType: string;
  size: number;
  ownerId: string;
  createdAt: number;
}

/**
 * Test owner IDs for consistent fixture relationships
 */
export const testOwners = {
  alice: "test-user-alice",
  bob: "test-user-bob",
  charlie: "test-user-charlie",
} as const;

/**
 * Sample launch item fixtures
 */
export const launchItemFixtures: LaunchItemFixture[] = [
  {
    title: "Build authentication system",
    description: "Implement user login and registration with email/password",
    status: "shipping",
    priority: 1,
    ownerId: testOwners.alice,
    createdAt: Date.now() - 7 * 24 * 60 * 60 * 1000, // 7 days ago
  },
  {
    title: "Add dark mode support",
    description: "Implement theme switching with system preference detection",
    status: "building",
    priority: 2,
    ownerId: testOwners.alice,
    createdAt: Date.now() - 3 * 24 * 60 * 60 * 1000, // 3 days ago
  },
  {
    title: "Mobile responsive design",
    description: "Ensure all pages work well on mobile devices",
    status: "building",
    priority: 3,
    ownerId: testOwners.bob,
    createdAt: Date.now() - 5 * 24 * 60 * 60 * 1000, // 5 days ago
  },
  {
    title: "API rate limiting",
    description: "Implement rate limiting to prevent abuse",
    status: "idea",
    priority: 4,
    ownerId: testOwners.alice,
    createdAt: Date.now() - 1 * 24 * 60 * 60 * 1000, // 1 day ago
  },
  {
    title: "File upload feature",
    description: "Allow users to upload and manage files",
    status: "idea",
    priority: 5,
    ownerId: testOwners.charlie,
    createdAt: Date.now(),
  },
];

/**
 * Sample upload fixtures
 */
export const uploadFixtures: UploadFixture[] = [
  {
    storageId: "storage-id-1",
    name: "profile-photo.jpg",
    contentType: "image/jpeg",
    size: 1024 * 100, // 100KB
    ownerId: testOwners.alice,
    createdAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
  },
  {
    storageId: "storage-id-2",
    name: "document.pdf",
    contentType: "application/pdf",
    size: 1024 * 500, // 500KB
    ownerId: testOwners.bob,
    createdAt: Date.now() - 1 * 24 * 60 * 60 * 1000,
  },
];

/**
 * Factory functions for creating custom fixtures
 */
export const createLaunchItem = (
  overrides: Partial<LaunchItemFixture> = {}
): LaunchItemFixture => ({
  title: "Test Launch Item",
  description: "A test item for automated testing",
  status: "idea",
  priority: 10,
  ownerId: testOwners.alice,
  createdAt: Date.now(),
  ...overrides,
});

export const createUpload = (
  overrides: Partial<UploadFixture> = {}
): UploadFixture => ({
  storageId: `storage-id-${Date.now()}`,
  name: "test-file.txt",
  contentType: "text/plain",
  size: 1024,
  ownerId: testOwners.alice,
  createdAt: Date.now(),
  ...overrides,
});

/**
 * Bulk fixture generators for testing pagination and lists
 */
export const createManyLaunchItems = (
  count: number,
  ownerId: string = testOwners.alice
): LaunchItemFixture[] => {
  return Array.from({ length: count }, (_, i) =>
    createLaunchItem({
      title: `Launch Item ${i + 1}`,
      description: `Description for item ${i + 1}`,
      priority: i + 1,
      ownerId,
      createdAt: Date.now() - i * 60 * 60 * 1000, // 1 hour apart
    })
  );
};

/**
 * Scenario-based fixtures for common test cases
 */
export const scenarios = {
  /**
   * Empty state - no data
   */
  empty: {
    launchItems: [] as LaunchItemFixture[],
    uploads: [] as UploadFixture[],
  },

  /**
   * Single user with a few items
   */
  singleUser: {
    launchItems: launchItemFixtures.filter((item) => item.ownerId === testOwners.alice),
    uploads: uploadFixtures.filter((upload) => upload.ownerId === testOwners.alice),
  },

  /**
   * Multiple users with items
   */
  multiUser: {
    launchItems: launchItemFixtures,
    uploads: uploadFixtures,
  },

  /**
   * Items in all status states
   */
  allStatuses: {
    launchItems: [
      createLaunchItem({ status: "idea", title: "Idea Item" }),
      createLaunchItem({ status: "building", title: "Building Item" }),
      createLaunchItem({ status: "shipping", title: "Shipping Item" }),
    ],
    uploads: [],
  },

  /**
   * Large dataset for pagination testing
   */
  pagination: {
    launchItems: createManyLaunchItems(50),
    uploads: [],
  },
};

/**
 * Helper to reset fixture timestamps to relative values
 * Useful when you need consistent time-based testing
 */
export const withRelativeTime = (
  fixtures: LaunchItemFixture[],
  baseTime: number = Date.now()
): LaunchItemFixture[] => {
  return fixtures.map((fixture, index) => ({
    ...fixture,
    createdAt: baseTime - index * 60 * 60 * 1000,
  }));
};
