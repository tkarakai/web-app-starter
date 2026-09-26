/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    auditTrail: {
      countPage: FunctionReference<
        "query",
        "internal",
        { cursor: string | null; numItems: number },
        {
          continueCursor: string;
          isDone: boolean;
          migrated: number;
          total: number;
        },
        Name
      >;
      envProbe: FunctionReference<
        "query",
        "internal",
        {},
        {
          retentionDays: string | null;
          seesUndeclaredBetterAuthSecret: boolean;
          siteUrl: string;
          visibleEnvKeys: Array<string>;
        },
        Name
      >;
      getByLegacyIds: FunctionReference<
        "query",
        "internal",
        { legacyIds: Array<string> },
        Array<{
          _creationTime: number;
          _id: string;
          action: string;
          actor: string;
          authenticatedUserId?: string;
          happenedAt: number;
          legacyCreationTime?: number;
          legacyId?: string;
          meta?: string;
          newValue?: string;
          oldValue?: string;
          reason?: string;
          resource: string;
          source: string;
          status: string;
          truncatedFields?: string;
        } | null>,
        Name
      >;
      importLegacyEvents: FunctionReference<
        "mutation",
        "internal",
        {
          events: Array<{
            action: string;
            actor: string;
            authenticatedUserId?: string;
            happenedAt: number;
            legacyCreationTime: number;
            legacyId: string;
            meta?: string;
            newValue?: string;
            oldValue?: string;
            reason?: string;
            resource: string;
            source: string;
            status: string;
            truncatedFields?: string;
          }>;
        },
        { inserted: number; skipped: number },
        Name
      >;
      insertEvent: FunctionReference<
        "mutation",
        "internal",
        {
          action: string;
          actor: string;
          authenticatedUserId?: string;
          happenedAt?: number;
          meta?: string;
          newValue?: string;
          oldValue?: string;
          reason?: string;
          resource: string;
          source: string;
          status: string;
        },
        string,
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        {
          filterAction?: string;
          filterActor?: string;
          filterAuthenticatedUserId?: string;
          filterSource?: string;
          filterStatus?: string;
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            _creationTime: number;
            _id: string;
            action: string;
            actor: string;
            authenticatedUserId?: string;
            happenedAt: number;
            legacyCreationTime?: number;
            legacyId?: string;
            meta?: string;
            newValue?: string;
            oldValue?: string;
            reason?: string;
            resource: string;
            source: string;
            status: string;
            truncatedFields?: string;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        },
        Name
      >;
    };
  };
