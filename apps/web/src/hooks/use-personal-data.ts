"use client";

import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { api, type Id } from "@repo/backend";
import type { FunctionArgs } from "convex/server";
import { authClient } from "@web-app-starter/auth/client";
import { useMutationWithToast } from "./use-mutation-with-toast";
import { mergePersonalProjects, planeArguments, planeAvailable, resolvePersonalDataContext, type PersonalDataPlane } from "./personal-data-context";
import { usePersonalDispatch } from "./use-personal-dispatch";

export function usePersonalDataContext() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const session = authClient.useSession();
  const browserUserId = session.data?.user.id;
  const signedIn = isAuthenticated && !isLoading && !session.isPending && Boolean(browserUserId);
  const currentUser = useQuery(api.platform.auth.getCurrentUser, signedIn ? {} : "skip");
  const sameAccount = signedIn && currentUser?._id === browserUserId;
  const mine = useQuery(api.platform.tenantContext.mine, sameAccount ? {} : "skip");
  const pending = isLoading || session.isPending || (signedIn && (currentUser === undefined || currentUser?._id !== browserUserId));
  const ownerId = sameAccount && currentUser ? (currentUser.userId ?? currentUser._id).toString() : null;
  return resolvePersonalDataContext(pending ? undefined : sameAccount ? mine : null, pending ? undefined : sameAccount ? currentUser!._id : null, ownerId);
}

export function usePersonalProjects() {
  const context = usePersonalDataContext();
  const scoped = useQuery(api.tenantProjects.list, context.tenant ? { organizationId: context.tenant.organizationId } : "skip");
  const legacy = useQuery(api.projects.list, context.legacy ? planeArguments(context.legacy) : "skip");
  return { context, projects: mergePersonalProjects(context, scoped, legacy) };
}

export function usePersonalProjectStats() {
  const context = usePersonalDataContext();
  const scoped = useQuery(api.tenantProjects.listWithStats, context.tenant ? { organizationId: context.tenant.organizationId } : "skip");
  const legacy = useQuery(api.projects.listWithStats, context.legacy ? planeArguments(context.legacy) : "skip");
  return mergePersonalProjects(context, scoped, legacy);
}

export function usePersonalProject(id: Id<"projects"> | null) {
  const { projects } = usePersonalProjects();
  // Select the plane from an authorized list, never by retrying an ID in a different API.
  const parent = id ? projects?.find(project => project._id === id) : undefined;
  const scoped = useQuery(api.tenantProjects.get, parent?.dataPlane.kind === "tenant" ? { id: parent._id, organizationId: parent.dataPlane.organizationId } : "skip");
  const legacy = useQuery(api.projects.get, parent?.dataPlane.kind === "legacy" ? { id: parent._id, ...planeArguments(parent.dataPlane) } : "skip");
  if (projects === undefined) return undefined;
  if (!parent) return null;
  const project = parent.dataPlane.kind === "tenant" ? scoped : legacy;
  if (project == null) return project;
  if (project._id !== parent._id || project.ownerId !== parent.dataPlane.ownerId || (parent.dataPlane.kind === "tenant" ? project.organizationId !== parent.dataPlane.organizationId : project.organizationId !== undefined)) return undefined;
  return { ...project, dataPlane: parent.dataPlane };
}

export function usePersonalProjectMutations(parent?: PersonalDataPlane, resourceId?: string) {
  const context = usePersonalDataContext();
  const capture = usePersonalDispatch(context, parent, resourceId);
  const captureCreation = usePersonalDispatch(context, undefined, resourceId);
  const createLegacy = useMutation(api.projects.create);
  const createScoped = useMutation(api.tenantProjects.create);
  const updateLegacy = useMutation(api.projects.update);
  const updateScoped = useMutation(api.tenantProjects.update);
  const removeLegacy = useMutation(api.projects.remove);
  const removeScoped = useMutation(api.tenantProjects.remove);
  return {
    available: planeAvailable(context, parent),
    create: (args: Omit<FunctionArgs<typeof api.tenantProjects.create>, "organizationId">) => {
      const request = captureCreation(); const { plane } = request;
      return request.dispatch(() => plane.kind === "tenant" ? createScoped({ ...args, organizationId: plane.organizationId }) : createLegacy({ ...args, ...planeArguments(plane) }));
    },
    update: (args: Omit<FunctionArgs<typeof api.tenantProjects.update>, "organizationId">) => {
      if (!parent) throw new Error("PROJECT_CONTEXT_REQUIRED");
      const request = capture(); const { plane } = request;
      return request.dispatch(() => plane.kind === "tenant" ? updateScoped({ ...args, organizationId: plane.organizationId }) : updateLegacy({ ...args, ...planeArguments(plane) }));
    },
    remove: (args: { id: Id<"projects"> }) => {
      if (!parent) throw new Error("PROJECT_CONTEXT_REQUIRED");
      const request = capture(); const { plane } = request;
      return request.dispatch(() => plane.kind === "tenant" ? removeScoped({ ...args, organizationId: plane.organizationId }) : removeLegacy({ ...args, ...planeArguments(plane) }));
    },
  };
}

export function usePersonalTasks(projectId: Id<"projects">, parent: PersonalDataPlane) {
  const context = usePersonalDataContext();
  const available = planeAvailable(context, parent);
  const scoped = useQuery(api.tenantTasks.listByProject, available && parent.kind === "tenant" ? { projectId, organizationId: parent.organizationId } : "skip");
  const legacy = useQuery(api.tasks.listByProject, available && parent.kind === "legacy" ? { projectId, ...planeArguments(parent) } : "skip");
  const rows = available ? parent.kind === "tenant" ? scoped : legacy : undefined;
  const stale = rows?.some(row => row.ownerId !== parent.ownerId || row.projectId !== projectId
    || (parent.kind === "tenant" ? row.organizationId !== parent.organizationId : row.organizationId !== undefined));
  return { state: context.state, available, tasks: stale ? undefined : rows ?? undefined };
}

export function usePersonalTaskMutations(parent: PersonalDataPlane, resourceId?: string) {
  const context = usePersonalDataContext();
  const capture = usePersonalDispatch(context, parent, resourceId);
  const createLegacy = useMutationWithToast(api.tasks.create);
  const createScoped = useMutationWithToast(api.tenantTasks.create);
  const updateLegacy = useMutationWithToast(api.tasks.update);
  const updateScoped = useMutationWithToast(api.tenantTasks.update);
  const removeLegacy = useMutationWithToast(api.tasks.remove);
  const removeScoped = useMutationWithToast(api.tenantTasks.remove);
  return {
    available: planeAvailable(context, parent),
    create: (args: Omit<FunctionArgs<typeof api.tenantTasks.create>, "organizationId">) => {
      const request = capture(); const { plane } = request;
      return request.dispatch(() => plane.kind === "tenant" ? createScoped({ ...args, organizationId: plane.organizationId }) : createLegacy({ ...args, ...planeArguments(plane) }));
    },
    update: (args: Omit<FunctionArgs<typeof api.tenantTasks.update>, "organizationId">) => {
      const request = capture(); const { plane } = request;
      return request.dispatch(() => plane.kind === "tenant" ? updateScoped({ ...args, organizationId: plane.organizationId }) : updateLegacy({ ...args, ...planeArguments(plane) }));
    },
    remove: (args: { id: Id<"tasks"> }) => {
      const request = capture(); const { plane } = request;
      return request.dispatch(() => plane.kind === "tenant" ? removeScoped({ ...args, organizationId: plane.organizationId }) : removeLegacy({ ...args, ...planeArguments(plane) }));
    },
  };
}

export function usePersonalFiles(projectId: Id<"projects">, parent: PersonalDataPlane) {
  const context = usePersonalDataContext();
  const capture = usePersonalDispatch(context, parent, projectId);
  const available = planeAvailable(context, parent);
  const scoped = useQuery(api.tenantFiles.listUploads, available && parent.kind === "tenant" ? { projectId, organizationId: parent.organizationId } : "skip");
  const legacy = useQuery(api.files.listUploads, available && parent.kind === "legacy" ? { projectId, ...planeArguments(parent) } : "skip");
  const uploadLegacy = useAction(api.files.uploadFile);
  const uploadScoped = useAction(api.tenantFiles.uploadFile);
  const downloadLegacy = useAction(api.files.downloadFile);
  const downloadScoped = useAction(api.tenantFiles.downloadFile);
  const deleteLegacy = useMutationWithToast(api.files.deleteUpload);
  const deleteScoped = useMutationWithToast(api.tenantFiles.deleteUpload);
  return {
    state: context.state,
    available,
    uploads: !available ? undefined : parent.kind === "tenant" ? scoped?.map(row => ({ ...row, available: true })) : legacy,
    // Call before reading bytes. Returned operations and retries retain this exact plane/ID.
    capture: () => {
      const request = capture(); const { plane } = request;
      return {
        upload: (args: Omit<FunctionArgs<typeof api.tenantFiles.uploadFile>, "organizationId" | "projectId">) => request.dispatch(() => plane.kind === "tenant"
          ? uploadScoped({ ...args, projectId, organizationId: plane.organizationId }) : uploadLegacy({ ...args, projectId, ...planeArguments(plane) })),
        download: (id: Id<"uploads">) => request.dispatch(() => plane.kind === "tenant"
          ? downloadScoped({ id, organizationId: plane.organizationId }) : downloadLegacy({ id, ...planeArguments(plane) })),
        remove: (id: Id<"uploads">) => request.dispatch(() => plane.kind === "tenant"
          ? deleteScoped({ id, organizationId: plane.organizationId }) : deleteLegacy({ id, ...planeArguments(plane) })),
      };
    },
  };
}
