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
    announcements: {
      archive: FunctionReference<
        "mutation",
        "internal",
        { announcementId: string; identity: { actor: string; userId: string } },
        null,
        Name
      >;
      create: FunctionReference<
        "mutation",
        "internal",
        {
          bannerText: string;
          callToActionName?: string;
          callToActionUrl?: string;
          identity: { actor: string; userId: string };
          learnMoreContent?: string;
          learnMoreName?: string;
          name: string;
          scheduleEnd?: number;
          scheduleStart?: number;
        },
        { id: string },
        Name
      >;
      getActiveInternal: FunctionReference<
        "query",
        "internal",
        {},
        {
          _id: string;
          bannerText: string;
          callToActionName?: string;
          callToActionUrl?: string;
          createdAt: number;
          isArchived?: boolean;
          isLive: boolean;
          learnMoreContent?: string;
          learnMoreName?: string;
          name: string;
          scheduleEnd?: number;
          scheduleStart?: number;
          updatedAt: number;
          updatedBy?: string;
        } | null,
        Name
      >;
      getActivePublic: FunctionReference<
        "query",
        "internal",
        {},
        {
          _id: string;
          bannerText: string;
          callToActionName?: string;
          callToActionUrl?: string;
          createdAt: number;
          isArchived?: boolean;
          isLive: boolean;
          learnMoreContent?: string;
          learnMoreName?: string;
          name: string;
          scheduleEnd?: number;
          scheduleStart?: number;
          updatedAt: number;
          updatedBy?: string;
        } | null,
        Name
      >;
      getAdminListInternal: FunctionReference<
        "query",
        "internal",
        { includeArchived?: boolean },
        Array<{
          _creationTime: number;
          _id: string;
          bannerText: string;
          callToActionName?: string;
          callToActionUrl?: string;
          createdAt: number;
          createdBy?: string;
          isActiveNow: boolean;
          isArchived?: boolean;
          isLive: boolean;
          isPublishNowEligible: boolean;
          learnMoreContent?: string;
          learnMoreName?: string;
          name: string;
          publishJobId?: string;
          scheduleEnd?: number;
          scheduleStart?: number;
          status:
            | "archived"
            | "live_now"
            | "scheduled"
            | "scheduled_cancelled"
            | "ready"
            | "draft"
            | "ended";
          unpublishJobId?: string;
          updatedAt: number;
          updatedBy?: string;
        }>,
        Name
      >;
      handleScheduledEnd: FunctionReference<
        "mutation",
        "internal",
        { announcementId: string; expectedScheduleEnd: number },
        null,
        Name
      >;
      handleScheduledStart: FunctionReference<
        "mutation",
        "internal",
        {
          announcementId: string;
          expectedScheduleEnd?: number;
          expectedScheduleStart: number;
        },
        null,
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        {
          includeArchived?: boolean;
          sortBy?: "scheduleStart" | "scheduleEnd" | "status" | "name";
          sortDirection?: "asc" | "desc";
        },
        Array<{
          _creationTime: number;
          _id: string;
          bannerText: string;
          callToActionName?: string;
          callToActionUrl?: string;
          createdAt: number;
          createdBy?: string;
          isActiveNow: boolean;
          isArchived?: boolean;
          isLive: boolean;
          isPublishNowEligible: boolean;
          learnMoreContent?: string;
          learnMoreName?: string;
          name: string;
          publishJobId?: string;
          scheduleEnd?: number;
          scheduleStart?: number;
          status:
            | "archived"
            | "live_now"
            | "scheduled"
            | "scheduled_cancelled"
            | "ready"
            | "draft"
            | "ended";
          unpublishJobId?: string;
          updatedAt: number;
          updatedBy?: string;
        }>,
        Name
      >;
      publishNow: FunctionReference<
        "mutation",
        "internal",
        { announcementId: string; identity: { actor: string; userId: string } },
        { disabledIds: Array<string> },
        Name
      >;
      publishNowInternal: FunctionReference<
        "mutation",
        "internal",
        { announcementId: string },
        { disabledIds: Array<string> },
        Name
      >;
      remove: FunctionReference<
        "mutation",
        "internal",
        { announcementId: string; identity: { actor: string; userId: string } },
        null,
        Name
      >;
      setLive: FunctionReference<
        "mutation",
        "internal",
        {
          announcementId: string;
          confirmDisableOthers?: boolean;
          identity: { actor: string; userId: string };
          isLive: boolean;
        },
        { disabledIds: Array<string> },
        Name
      >;
      unpublishNow: FunctionReference<
        "mutation",
        "internal",
        { announcementId: string; identity: { actor: string; userId: string } },
        null,
        Name
      >;
      unpublishNowInternal: FunctionReference<
        "mutation",
        "internal",
        { announcementId: string },
        null,
        Name
      >;
      update: FunctionReference<
        "mutation",
        "internal",
        {
          announcementId: string;
          identity: { actor: string; userId: string };
          patch: {
            bannerText?: string;
            callToActionName?: string;
            callToActionUrl?: string;
            learnMoreContent?: string;
            learnMoreName?: string;
            name?: string;
            scheduleEnd?: number | null;
            scheduleStart?: number | null;
          };
        },
        null,
        Name
      >;
    };
    appSettings: {
      get: FunctionReference<
        "query",
        "internal",
        { key: string },
        | string
        | number
        | boolean
        | null
        | { html: string; subject: string; text: string },
        Name
      >;
      getInternal: FunctionReference<
        "query",
        "internal",
        { key: string },
        | string
        | number
        | boolean
        | null
        | { html: string; subject: string; text: string },
        Name
      >;
      getPublic: FunctionReference<
        "query",
        "internal",
        { key: string },
        | string
        | number
        | boolean
        | null
        | { html: string; subject: string; text: string },
        Name
      >;
      getRaw: FunctionReference<
        "query",
        "internal",
        { key: string },
        {
          _creationTime: number;
          _id: string;
          key: string;
          updatedAt: number;
          updatedBy?: string;
          value: string;
        } | null,
        Name
      >;
      putRaw: FunctionReference<
        "mutation",
        "internal",
        { key: string; updatedBy?: string; value: string },
        { previousValue?: string },
        Name
      >;
      remove: FunctionReference<
        "mutation",
        "internal",
        { key: string },
        null,
        Name
      >;
      set: FunctionReference<
        "mutation",
        "internal",
        { key: string; userId: string; value: string },
        null,
        Name
      >;
    };
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
