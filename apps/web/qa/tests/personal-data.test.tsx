import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import platformMessages from "@web-app-starter/i18n/messages/en.json";
import appMessages from "@repo/messages/en.json";
import { MEMBERSHIP_MANAGEMENT_EXPERIENCE, ORG_ADMIN_MEMBERSHIP_ROLE, ORG_MEMBER_ROLE, type Id } from "@repo/backend";
import { capturePersonalDataPlane, resolvePersonalDataContext, type PersonalContextSnapshot, type PersonalDataPlane } from "../../src/hooks/personal-data-context";

const mocks = vi.hoisted(() => ({
  authenticated: true,
  loading: false,
  browserUserId: "owner" as string | null,
  sessionPending: false,
  data: {} as Record<string, unknown>,
  query: vi.fn(),
  dispatch: vi.fn(),
}));
vi.mock("@repo/backend", async importOriginal => ({ ...await importOriginal<typeof import("@repo/backend")>(), api: {
  platform: { tenantContext: { mine: "mine" }, auth: { getCurrentUser: "currentUser" } },
  projects: { list: "projects.list", get: "projects.get", listWithStats: "projects.stats", create: "projects.create", update: "projects.update", remove: "projects.remove" },
  tenantProjects: { list: "tenantProjects.list", get: "tenantProjects.get", listWithStats: "tenantProjects.stats", create: "tenantProjects.create", update: "tenantProjects.update", remove: "tenantProjects.remove" },
  tasks: { listByProject: "tasks.list", create: "tasks.create", update: "tasks.update", remove: "tasks.remove" },
  tenantTasks: { listByProject: "tenantTasks.list", create: "tenantTasks.create", update: "tenantTasks.update", remove: "tenantTasks.remove" },
  files: { listUploads: "files.list", uploadFile: "files.upload", downloadFile: "files.download", deleteUpload: "files.remove" },
  tenantFiles: { listUploads: "tenantFiles.list", uploadFile: "tenantFiles.upload", downloadFile: "tenantFiles.download", deleteUpload: "tenantFiles.remove" },
} }));
vi.mock("@web-app-starter/i18n/navigation", () => ({ Link: (props: { href: string; children: React.ReactNode; className?: string }) => <a {...props} /> }));
vi.mock("@web-app-starter/auth/client", () => ({ authClient: { useSession: () => ({ data: mocks.browserUserId ? { user: { id: mocks.browserUserId } } : null, isPending: mocks.sessionPending }) } }));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: mocks.authenticated, isLoading: mocks.loading }),
  useQuery: (reference: string, args: unknown) => { mocks.query(reference, args); return args === "skip" ? undefined : mocks.data[reference]; },
  useQueries: (queries: Record<string, { query: string; args: unknown }>) => Object.fromEntries(Object.entries(queries).map(([key, { query, args }]) => { mocks.query(query, args); return [key, mocks.data[query]]; })),
  useMutation: (reference: string) => (args: unknown) => mocks.dispatch(reference, args),
  useAction: (reference: string) => (args: unknown) => mocks.dispatch(reference, args),
}));
vi.mock("@/hooks/use-mutation-with-toast", () => ({ useMutationWithToast: (reference: string) => (args: unknown) => mocks.dispatch(reference, args) }));

import { usePersonalDataContext, usePersonalFiles, usePersonalProject, usePersonalProjectMutations, usePersonalProjects, usePersonalProjectStats, usePersonalTaskMutations, usePersonalTasks } from "../../src/hooks/use-personal-data";
import { readOrganizationSelection, selectOrganization } from "../../src/hooks/organization-selection";
import { UploadPanel } from "../../src/components/projects/upload-panel";
import { PersonalDataNotReady } from "../../src/components/projects/personal-data-not-ready";

const projectId = "project-a" as Id<"projects">;
const taskId = "task-a" as Id<"tasks">;
const uploadId = "upload-a" as Id<"uploads">;
const tenant: PersonalDataPlane = { kind: "tenant", userId: "owner", ownerId: "owner", organizationId: "org-a" };
const legacy: PersonalDataPlane = { kind: "legacy", userId: "owner", ownerId: "owner", organizationId: "org-a" };
function personal(organizationId = "org-a", legacyPrivateAvailable = false): PersonalContextSnapshot {
  return { userId: "owner", contexts: [{ organizationId, experience: "personal", lifecycle: "active", personal: true, role: ORG_ADMIN_MEMBERSHIP_ROLE }], personalOrganizationId: organizationId, legacyPrivateAvailable };
}
function row(id: string, organizationId?: string, time = 1) {
  return { _id: id, _creationTime: time, organizationId, ownerId: "owner", name: id, description: "", createdAt: time };
}
function activeQueries() { return mocks.query.mock.calls.filter(([, args]) => args !== "skip"); }

describe("personal sample caller context and dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear(); window.history.replaceState({}, "", "/");
    mocks.authenticated = true; mocks.loading = false; mocks.browserUserId = "owner"; mocks.sessionPending = false;
    mocks.data = { currentUser: { _id: "owner", role: "user" }, mine: personal(), "tenantProjects.list": [], "tenantProjects.stats": [], "projects.list": [], "projects.stats": [], "tenantTasks.list": [], "tasks.list": [], "tenantFiles.list": [], "files.list": [] };
    mocks.dispatch.mockResolvedValue(projectId);
  });

  it("requires explicit selection for two memberships and honors authorized member deep links", async () => {
    const original = personal();
    mocks.data.mine = { ...original, contexts: [...original.contexts, { ...original.contexts[0], organizationId: "org-b", personal: false, experience: MEMBERSHIP_MANAGEMENT_EXPERIENCE, role: ORG_MEMBER_ROLE }] };
    const { result } = renderHook(() => ({ context: usePersonalDataContext(), commands: usePersonalProjectMutations() }));
    expect(result.current.context.state).toBe("unavailable");
    act(() => selectOrganization("owner", "org-b"));
    expect(result.current.context.tenant).toEqual({ kind: "tenant", userId: "owner", ownerId: "owner", organizationId: "org-b" });
    expect(result.current.context.legacy).toBeNull();
    await result.current.commands.create({ name: "Mine only", description: "" });
    expect(mocks.dispatch).toHaveBeenCalledWith("tenantProjects.create", { organizationId: "org-b", name: "Mine only", description: "" });
    expect(window.localStorage.getItem("organization-context:owner")).toBeNull();
    expect(window.sessionStorage.getItem("organization-context:owner")).toBe("org-b");
    expect(readOrganizationSelection("different-account")).toBe("org-b"); // A URL is a request, never authority.
    mocks.dispatch.mockClear();
    act(() => selectOrganization("owner", "foreign"));
    expect(result.current.context.state).toBe("unavailable");
    expect(() => result.current.commands.create({ name: "Denied", description: "" })).toThrow("PERSONAL_CONTEXT_UNAVAILABLE");
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("retires prepared operations across tab-local selection ABA and ignores cross-tab storage", async () => {
    const original = personal();
    mocks.data.mine = { ...original, contexts: [...original.contexts, { ...original.contexts[0], organizationId: "org-b", personal: false }] };
    selectOrganization("owner", "org-a");
    const { result } = renderHook(() => ({ commands: usePersonalProjectMutations(), files: usePersonalFiles(projectId, tenant) }));
    const create = result.current.commands.create; const transfer = result.current.files.capture();
    act(() => window.dispatchEvent(new window.StorageEvent("storage", { key: "organization-context:owner", newValue: "org-b" })));
    expect(readOrganizationSelection("owner")).toBe("org-a");
    act(() => selectOrganization("owner", "org-b"));
    act(() => selectOrganization("owner", "org-a"));
    expect(() => create({ name: "Old", description: "" })).toThrow("PERSONAL_CONTEXT_CHANGED");
    expect(() => transfer.download(uploadId)).toThrow("PERSONAL_CONTEXT_CHANGED");
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("does not fallback from an invalid explicit link, including an empty ID", () => {
    selectOrganization("owner", "org-a");
    window.history.replaceState({}, "", "/?organizationId=");
    const { result } = renderHook(() => usePersonalDataContext());
    expect(result.current).toMatchObject({ state: "unavailable", tenant: null, legacy: null });
  });

  it("contains reactive access errors and drops previously visible private rows", () => {
    mocks.data["tenantProjects.list"] = [row(projectId, "org-a")];
    const { result, rerender } = renderHook(() => usePersonalProjects());
    expect(result.current.projects).toHaveLength(1);
    mocks.data["tenantProjects.list"] = new Error("ORGANIZATION_UNAVAILABLE"); rerender();
    expect(result.current.projects).toBeUndefined();
    expect(result.current.context.state).toBe("unavailable");
    mocks.data.mine = new Error("NOT_AUTHENTICATED"); rerender();
    expect(result.current.context.state).toBe("unavailable");
  });

  it("holds loading, disabled, ambiguous, member-only and unmapped states without legacy guessing", () => {
    expect(resolvePersonalDataContext(undefined, "owner").state).toBe("loading");
    const canonical = personal();
    const context = canonical.contexts[0]!;
    for (const mine of [null, { userId: "owner", contexts: [], personalOrganizationId: null }, { ...canonical, personalOrganizationId: "guessed" },
      { ...canonical, legacyPrivateAvailable: true, contexts: [{ ...context, lifecycle: "disabled" as const }] },
      { ...canonical, legacyPrivateAvailable: true, contexts: [{ ...context, lifecycle: "provisioning" as const }] },
      { ...canonical, contexts: [context, { ...context, organizationId: "other" }] },
      { ...canonical, contexts: [{ ...context, personal: false, role: ORG_MEMBER_ROLE }] },
      { ...canonical, contexts: [{ ...context, experience: MEMBERSHIP_MANAGEMENT_EXPERIENCE }] }]) {
      expect(resolvePersonalDataContext(mine, "owner")).toMatchObject({ state: "unavailable", tenant: null, legacy: null });
    }
    mocks.data.mine = { ...canonical, contexts: [{ ...context, lifecycle: "disabled" }] };
    const { result } = renderHook(() => ({ projects: usePersonalProjects(), commands: usePersonalProjectMutations() }));
    expect(result.current.projects.projects).toBeUndefined();
    expect(result.current.commands.available).toBe(false);
    expect(() => result.current.commands.create({ name: "Blocked", description: "" })).toThrow("PERSONAL_CONTEXT_UNAVAILABLE");
    expect(activeQueries().every(([name]) => name === "mine" || name === "currentUser")).toBe(true);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("skips canonical discovery and private queries when signed out", () => {
    mocks.authenticated = false;
    const { result } = renderHook(() => usePersonalProjects());
    expect(result.current.context.state).toBe("unavailable");
    expect(result.current.projects).toBeUndefined();
    expect(activeQueries()).toEqual([]);
  });

  it("holds all reads and dispatch while authentication is still loading", () => {
    mocks.loading = true;
    const { result } = renderHook(() => ({ context: usePersonalDataContext(), commands: usePersonalProjectMutations() }));
    expect(result.current.context.state).toBe("loading");
    expect(result.current.commands.available).toBe(false);
    expect(activeQueries()).toEqual([]);
    expect(() => result.current.commands.create({ name: "Pending", description: "" })).toThrow("PERSONAL_CONTEXT_UNAVAILABLE");
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("uses scoped queries and new creation whenever a canonical personal organization exists", async () => {
    mocks.data["tenantProjects.list"] = [row(projectId, "org-a")];
    const { result } = renderHook(() => ({ list: usePersonalProjects(), commands: usePersonalProjectMutations(tenant) }));
    expect(result.current.list.projects?.[0]?.dataPlane).toEqual(tenant);
    expect(activeQueries()).toContainEqual(["tenantProjects.list", { organizationId: "org-a" }]);
    expect(activeQueries().some(([name]) => name === "projects.list")).toBe(false);
    await result.current.commands.create({ name: "Scoped", description: "" });
    await result.current.commands.update({ id: projectId, name: "Updated" });
    await result.current.commands.remove({ id: projectId });
    expect(mocks.dispatch.mock.calls).toEqual([
      ["tenantProjects.create", { organizationId: "org-a", name: "Scoped", description: "" }],
      ["tenantProjects.update", { organizationId: "org-a", id: projectId, name: "Updated" }],
      ["tenantProjects.remove", { organizationId: "org-a", id: projectId }],
    ]);
  });

  it("merges explicitly authorized legacy rows alongside scoped rows, preserving their parent plane", async () => {
    mocks.data.mine = personal("org-a", true);
    mocks.data["tenantProjects.list"] = [row("scoped", "org-a", 2)];
    mocks.data["projects.list"] = [row(projectId, undefined, 1)];
    mocks.data["projects.get"] = row(projectId);
    const { result } = renderHook(() => ({ list: usePersonalProjects(), detail: usePersonalProject(projectId), commands: usePersonalProjectMutations(legacy) }));
    expect(result.current.list.projects?.map(project => [project._id, project.dataPlane.kind])).toEqual([["scoped", "tenant"], [projectId, "legacy"]]);
    expect(result.current.detail?.dataPlane).toEqual(legacy);
    expect(activeQueries()).toContainEqual(["projects.get", { id: projectId, organizationId: "org-a" }]);
    expect(activeQueries().some(([name]) => name === "tenantProjects.get")).toBe(false);
    await result.current.commands.update({ id: projectId, description: "Legacy edit" });
    await result.current.commands.remove({ id: projectId });
    await result.current.commands.create({ name: "New", description: "" });
    expect(mocks.dispatch.mock.calls).toEqual([
      ["projects.update", { id: projectId, description: "Legacy edit", organizationId: "org-a" }],
      ["projects.remove", { id: projectId, organizationId: "org-a" }],
      ["tenantProjects.create", { name: "New", description: "", organizationId: "org-a" }],
    ]);
  });

  it("permits legacy-only historical users solely through the explicit backend flag", async () => {
    mocks.data.mine = { userId: "owner", contexts: [], personalOrganizationId: null, legacyPrivateAvailable: true };
    mocks.data["projects.list"] = [row(projectId)];
    const { result } = renderHook(() => ({ list: usePersonalProjects(), commands: usePersonalProjectMutations() }));
    expect(result.current.list.projects?.[0]?.dataPlane).toEqual({ kind: "legacy", userId: "owner", ownerId: "owner" });
    expect(activeQueries()).toContainEqual(["projects.list", {}]);
    expect(activeQueries().some(([name]) => name === "tenantProjects.list")).toBe(false);
    await result.current.commands.create({ name: "Historical", description: "" });
    expect(mocks.dispatch).toHaveBeenCalledWith("projects.create", { name: "Historical", description: "" });
  });

  it("combines stats through separate authorized APIs and never retries a nullable scoped get in legacy", () => {
    mocks.data.mine = personal("org-a", true);
    mocks.data["tenantProjects.list"] = [row(projectId, "org-a")];
    mocks.data["tenantProjects.get"] = null;
    mocks.data["tenantProjects.stats"] = [{ ...row("scoped", "org-a", 2), taskCount: 2, doneCount: 1, uploadCount: 1 }];
    mocks.data["projects.stats"] = [{ ...row("old", undefined, 1), taskCount: 1, doneCount: 0, uploadCount: 1 }];
    const { result } = renderHook(() => ({ detail: usePersonalProject(projectId), stats: usePersonalProjectStats() }));
    expect(result.current.detail).toBeNull();
    expect(result.current.stats?.map(project => [project._id, project.taskCount, project.dataPlane.kind])).toEqual([["scoped", 2, "tenant"], ["old", 1, "legacy"]]);
    expect(activeQueries()).toContainEqual(["tenantProjects.get", { organizationId: "org-a", id: projectId }]);
    expect(activeQueries().some(([name]) => name === "projects.get")).toBe(false);
  });

  it("does not guess a plane or probe either get API for a foreign or unmapped project ID", () => {
    mocks.data.mine = personal("org-a", true);
    const { result } = renderHook(() => usePersonalProject(projectId));
    expect(result.current).toBeNull();
    expect(activeQueries().some(([name]) => name === "projects.get" || name === "tenantProjects.get")).toBe(false);
  });

  it.each([tenant, legacy])("task children keep the $kind parent plane for reads, creation, updates and deletion", async parent => {
    mocks.data.mine = personal("org-a", true);
    const { result } = renderHook(() => ({ list: usePersonalTasks(projectId, parent), commands: usePersonalTaskMutations(parent) }));
    const prefix = parent.kind === "tenant" ? "tenantTasks" : "tasks";
    expect(activeQueries()).toContainEqual([`${prefix}.list`, { projectId, organizationId: "org-a" }]);
    await result.current.commands.create({ projectId, title: "Child", description: "", status: "todo" });
    await result.current.commands.update({ id: taskId, status: "done", deadline: null });
    await result.current.commands.remove({ id: taskId });
    expect(mocks.dispatch.mock.calls).toEqual([
      [`${prefix}.create`, { organizationId: "org-a", projectId, title: "Child", description: "", status: "todo" }],
      [`${prefix}.update`, { organizationId: "org-a", id: taskId, status: "done", deadline: null }],
      [`${prefix}.remove`, { organizationId: "org-a", id: taskId }],
    ]);
  });

  it("skips children and blocks new dispatch when the parent no longer matches canonical context", () => {
    mocks.data.mine = personal("org-b", true);
    const { result } = renderHook(() => ({ tasks: usePersonalTasks(projectId, tenant), commands: usePersonalTaskMutations(tenant), files: usePersonalFiles(projectId, legacy) }));
    expect(result.current.tasks).toMatchObject({ available: false, tasks: undefined });
    expect(result.current.files).toMatchObject({ available: false, uploads: undefined });
    expect(() => result.current.commands.update({ id: taskId, title: "Cannot retarget" })).toThrow("PERSONAL_CONTEXT_UNAVAILABLE");
    expect(() => result.current.files.capture()).toThrow("PERSONAL_CONTEXT_UNAVAILABLE");
    expect(activeQueries().every(([name]) => name === "mine" || name === "currentUser")).toBe(true);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it.each([tenant, legacy])("file transfers and deletion keep the $kind parent plane and private availability", async parent => {
    mocks.data.mine = personal("org-a", true);
    mocks.data["tenantFiles.list"] = [{ _id: uploadId, name: "Scoped", contentType: "text/plain", size: 1 }];
    mocks.data["files.list"] = [{ _id: uploadId, name: "Old", contentType: "text/plain", size: 1, available: false }];
    const { result } = renderHook(() => usePersonalFiles(projectId, parent));
    expect(result.current.uploads?.[0]?.available).toBe(parent.kind === "tenant");
    const request = result.current.capture(); const bytes = new ArrayBuffer(1);
    await request.upload({ name: "Bound", contentType: "text/plain", bytes });
    await request.download(uploadId); await request.remove(uploadId);
    const prefix = parent.kind === "tenant" ? "tenantFiles" : "files";
    expect(mocks.dispatch.mock.calls).toEqual([
      [`${prefix}.upload`, { organizationId: "org-a", projectId, name: "Bound", contentType: "text/plain", bytes }],
      [`${prefix}.download`, { organizationId: "org-a", id: uploadId }],
      [`${prefix}.remove`, { organizationId: "org-a", id: uploadId }],
    ]);
  });

  it("captured uploads and retries retain their immutable IDs across ordinary rerenders", async () => {
    const { result, rerender } = renderHook(() => usePersonalFiles(projectId, tenant));
    const request = result.current.capture();
    const captured = capturePersonalDataPlane(resolvePersonalDataContext(personal(), "owner"), tenant);
    expect(Object.isFrozen(captured)).toBe(true);
    mocks.data.mine = personal(); rerender();
    expect(result.current.available).toBe(true);
    await request.upload({ name: "Retry", contentType: "text/plain", bytes: new ArrayBuffer(0) });
    await request.upload({ name: "Retry", contentType: "text/plain", bytes: new ArrayBuffer(0) });
    for (const [, args] of mocks.dispatch.mock.calls) expect(args).toMatchObject({ projectId, organizationId: "org-a" });
  });

  it("the real upload panel captures before reading bytes and cancels pending dispatch after a scope change", async () => {
    let release!: (bytes: ArrayBuffer) => void;
    const bytes = new Promise<ArrayBuffer>(resolve => { release = resolve; });
    const wrapper = (parent: PersonalDataPlane, id: Id<"projects">) => <NextIntlClientProvider locale="en" messages={{ ...platformMessages, ...appMessages }}><UploadPanel projectId={id} dataPlane={parent} collapsible={false} /></NextIntlClientProvider>;
    const view = render(wrapper(tenant, projectId));
    const input = view.container.querySelector('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [{ name: "Document.txt", size: 1, type: "text/plain", arrayBuffer: () => bytes }] } });
    expect(mocks.dispatch).not.toHaveBeenCalled();
    mocks.data.mine = personal("org-b");
    view.rerender(wrapper({ kind: "tenant", userId: "owner", ownerId: "owner", organizationId: "org-b" }, "project-b" as Id<"projects">));
    await act(async () => release(new ArrayBuffer(1)));
    await waitFor(() => expect(view.getByText(appMessages.uploads.errors.uploadFailed)).toBeInTheDocument());
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("holds stale mine DTOs from another account and skips all private reads", () => {
    mocks.browserUserId = "new-account";
    mocks.data.currentUser = { _id: "new-account", role: "user" };
    // The resolver still has an old cached account response, including legacy permission.
    mocks.data.mine = personal("org-a", true);
    const { result } = renderHook(() => ({ list: usePersonalProjects(), commands: usePersonalProjectMutations() }));
    expect(result.current.list.context.state).toBe("loading");
    expect(result.current.list.projects).toBeUndefined();
    expect(result.current.commands.available).toBe(false);
    expect(activeQueries().every(([name]) => name === "mine" || name === "currentUser")).toBe(true);
    expect(() => result.current.commands.create({ name: "Stale realm", description: "" })).toThrow("PERSONAL_CONTEXT_UNAVAILABLE");
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("also holds when the Convex current-user response belongs to the previous browser account", () => {
    mocks.browserUserId = "new-account";
    const { result } = renderHook(() => usePersonalProjects());
    expect(result.current.context.state).toBe("loading");
    expect(activeQueries()).toEqual([["currentUser", {}]]);
    expect(result.current.projects).toBeUndefined();
  });

  it("does not display cached private rows from an old account after mine catches up", () => {
    mocks.browserUserId = "new-account";
    mocks.data.currentUser = { _id: "new-account", role: "user" };
    mocks.data.mine = { userId: "new-account", contexts: [], personalOrganizationId: null, legacyPrivateAvailable: true };
    mocks.data["projects.list"] = [row(projectId)];
    const { result } = renderHook(() => usePersonalProjects());
    expect(result.current.context.state).toBe("ready");
    expect(result.current.projects).toBeUndefined();
  });

  it("uses the canonical owner's linked ID without sending principal metadata as API arguments", async () => {
    mocks.data.currentUser = { _id: "owner", userId: "linked-owner", role: "user" };
    mocks.data["tenantProjects.list"] = [{ ...row(projectId, "org-a"), ownerId: "linked-owner" }];
    const { result } = renderHook(() => ({ list: usePersonalProjects(), commands: usePersonalProjectMutations() }));
    expect(result.current.list.projects?.map(project => project._id)).toEqual([projectId]);
    expect(result.current.list.projects?.[0]?.dataPlane).toMatchObject({ userId: "owner", ownerId: "linked-owner" });
    await result.current.commands.create({ name: "Bound", description: "" });
    expect(mocks.dispatch).toHaveBeenCalledWith("tenantProjects.create", { organizationId: "org-a", name: "Bound", description: "" });
  });

  it("retires captured transfers on scope changes and never resurrects them on A→B→A", async () => {
    const { result, rerender } = renderHook(() => usePersonalFiles(projectId, tenant));
    const request = result.current.capture();
    mocks.data.mine = personal("org-b"); rerender();
    expect(() => request.download(uploadId)).toThrow("PERSONAL_CONTEXT_CHANGED");
    mocks.data.mine = personal(); rerender();
    expect(result.current.available).toBe(true);
    expect(() => request.upload({ name: "Old retry", contentType: "text/plain", bytes: new ArrayBuffer(0) })).toThrow("PERSONAL_CONTEXT_CHANGED");
    expect(mocks.dispatch).not.toHaveBeenCalled();
    await result.current.capture().download(uploadId);
    expect(mocks.dispatch).toHaveBeenCalledWith("tenantFiles.download", { organizationId: "org-a", id: uploadId });
  });

  it("retires held project/task mutation callbacks and legacy-only transfers on account change", () => {
    const historical: PersonalDataPlane = { kind: "legacy", userId: "owner", ownerId: "owner" };
    mocks.data.mine = { userId: "owner", contexts: [], personalOrganizationId: null, legacyPrivateAvailable: true };
    const { result, rerender } = renderHook(() => ({ projects: usePersonalProjectMutations(historical), tasks: usePersonalTaskMutations(historical), files: usePersonalFiles(projectId, historical) }));
    const create = result.current.projects.create;
    const update = result.current.tasks.update;
    const request = result.current.files.capture();
    mocks.browserUserId = "new-account";
    mocks.data.currentUser = { _id: "new-account", role: "user" };
    mocks.data.mine = { userId: "new-account", contexts: [], personalOrganizationId: null, legacyPrivateAvailable: true };
    rerender();
    expect(() => create({ name: "Old callback", description: "" })).toThrow("PERSONAL_CONTEXT_CHANGED");
    expect(() => update({ id: taskId, status: "done" })).toThrow("PERSONAL_CONTEXT_CHANGED");
    expect(() => request.download(uploadId)).toThrow("PERSONAL_CONTEXT_CHANGED");
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("retires prepared transfers when only the parent project changes within the same account and organization", async () => {
    const { result, rerender } = renderHook(({ id }) => usePersonalFiles(id, tenant), { initialProps: { id: projectId } });
    const old = result.current.capture();
    const nextProjectId = "project-b" as Id<"projects">;
    rerender({ id: nextProjectId });
    expect(() => old.upload({ name: "Stale project", contentType: "text/plain", bytes: new ArrayBuffer(0) })).toThrow("PERSONAL_CONTEXT_CHANGED");
    expect(mocks.dispatch).not.toHaveBeenCalled();
    const bytes = new ArrayBuffer(1);
    await result.current.capture().upload({ name: "Current project", contentType: "text/plain", bytes });
    expect(mocks.dispatch).toHaveBeenCalledWith("tenantFiles.upload", { organizationId: "org-a", projectId: nextProjectId, name: "Current project", contentType: "text/plain", bytes });
  });

  it("invalidates held callbacks on unmount and discards a late byte response", async () => {
    let release!: (file: { bytes: ArrayBuffer; name: string; contentType: string }) => void;
    mocks.dispatch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const { result, unmount } = renderHook(() => ({ files: usePersonalFiles(projectId, tenant), commands: usePersonalProjectMutations() }));
    const request = result.current.files.capture();
    const create = result.current.commands.create;
    const transfer = request.download(uploadId);
    unmount();
    release({ bytes: new ArrayBuffer(1), name: "Old private result", contentType: "text/plain" });
    await expect(transfer).rejects.toThrow("PERSONAL_CONTEXT_CHANGED");
    expect(() => request.remove(uploadId)).toThrow("PERSONAL_CONTEXT_CHANGED");
    expect(() => create({ name: "Unmounted", description: "" })).toThrow("PERSONAL_CONTEXT_CHANGED");
    expect(mocks.dispatch).toHaveBeenCalledOnce();
    expect(mocks.dispatch).toHaveBeenCalledWith("tenantFiles.download", { organizationId: "org-a", id: uploadId });
  });

  it("renders an explicit localized not-ready status instead of an empty-data fallback", () => {
    const wrapper = (state: "loading" | "unavailable") => <NextIntlClientProvider locale="en" messages={{ ...platformMessages, ...appMessages }}><PersonalDataNotReady state={state} /></NextIntlClientProvider>;
    const view = render(wrapper("unavailable"));
    expect(view.getByRole("status")).toHaveTextContent(platformMessages.common.error);
    expect(view.getByRole("status")).toHaveAttribute("data-personal-data-state", "unavailable");
    view.rerender(wrapper("loading"));
    expect(view.getByRole("status")).toHaveTextContent(platformMessages.common.loading);
    expect(view.getByRole("status")).toHaveAttribute("data-personal-data-state", "loading");
  });

  it.each(["loading", "provisioning", "disabled"])("never falls back to legacy reads while mine is %s", state => {
    mocks.data.mine = state === "loading" ? undefined : { ...personal("org-a", true), contexts: [{ ...personal().contexts[0]!, lifecycle: state }] };
    const { result } = renderHook(() => ({ projects: usePersonalProjects(), files: usePersonalFiles(projectId, legacy) }));
    expect(result.current.projects.projects).toBeUndefined();
    expect(result.current.files.uploads).toBeUndefined();
    expect(result.current.files.available).toBe(false);
    expect(() => result.current.files.capture()).toThrow("PERSONAL_CONTEXT_UNAVAILABLE");
    expect(activeQueries().every(([name]) => name === "mine" || name === "currentUser")).toBe(true);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("holds stale list/detail/task responses instead of exposing partial results or guessing another plane", () => {
    mocks.data.mine = personal("org-a", true);
    mocks.data["tenantProjects.list"] = [row(projectId, "org-b")];
    const lists = renderHook(() => usePersonalProjects());
    expect(lists.result.current.projects).toBeUndefined();
    mocks.data["tenantProjects.list"] = [row(projectId, "org-a")];
    mocks.data["tenantProjects.get"] = { ...row(projectId, "org-a"), ownerId: "other-account" };
    mocks.data["tenantTasks.list"] = [{ _id: taskId, ownerId: "other-account", organizationId: "org-a", projectId }];
    const children = renderHook(() => ({ project: usePersonalProject(projectId), tasks: usePersonalTasks(projectId, tenant) }));
    expect(children.result.current.project).toBeUndefined();
    expect(children.result.current.tasks.tasks).toBeUndefined();
    expect(activeQueries().some(([name]) => name === "projects.get" || name === "tasks.list")).toBe(false);
  });
});
