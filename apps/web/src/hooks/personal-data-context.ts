import { ORG_ADMIN_MEMBERSHIP_ROLE, ORG_MEMBER_ROLE, type OrganizationExperience } from "@repo/backend";

/** Authorized membership snapshot. Mutable auth-session preferences never select a data plane. */
export interface PersonalContextSnapshot {
  userId: string;
  contexts: { organizationId: string; experience: OrganizationExperience; lifecycle: "active" | "disabled" | "provisioning"; role: typeof ORG_ADMIN_MEMBERSHIP_ROLE | typeof ORG_MEMBER_ROLE; personal: boolean }[];
  personalOrganizationId: string | null;
  legacyPrivateAvailable?: boolean;
}
type TenantDataPlane = Readonly<{ kind: "tenant"; userId: string; ownerId: string; organizationId: string }>;
type LegacyDataPlane = Readonly<{ kind: "legacy"; userId: string; ownerId: string; organizationId?: string }>;
export type PersonalDataPlane = TenantDataPlane | LegacyDataPlane;
export interface PersonalDataContext {
  state: "loading" | "ready" | "unavailable";
  userId: string | null;
  ownerId: string | null;
  tenant: TenantDataPlane | null;
  legacy: LegacyDataPlane | null;
}
export function resolvePersonalDataContext(mine: PersonalContextSnapshot | null | undefined, currentUserId: string | null | undefined, ownerId = currentUserId, selectedOrganizationId?: string | null): PersonalDataContext {
  if (mine === undefined || currentUserId === undefined) return { state: "loading", userId: null, ownerId: null, tenant: null, legacy: null };
  if (!mine || !currentUserId || !ownerId) return { state: "unavailable", userId: null, ownerId: null, tenant: null, legacy: null };
  if (mine.userId !== currentUserId) return { state: "loading", userId: null, ownerId: null, tenant: null, legacy: null };
  if (selectedOrganizationId !== undefined && selectedOrganizationId !== null) {
    const selected = mine.contexts.find(item => item.organizationId === selectedOrganizationId);
    if (!selected || !selected.organizationId || selected.lifecycle !== "active") return { state: "unavailable", userId: currentUserId, ownerId, tenant: null, legacy: null };
    const privateBridge = mine.contexts.length === 1 && selected.personal && selected.experience === "personal"
      && selected.role === ORG_ADMIN_MEMBERSHIP_ROLE && selected.organizationId === mine.personalOrganizationId && mine.legacyPrivateAvailable === true;
    return { state: "ready", userId: currentUserId, ownerId,
      tenant: Object.freeze({ kind: "tenant", userId: currentUserId, ownerId, organizationId: selected.organizationId }),
      legacy: privateBridge ? Object.freeze({ kind: "legacy", userId: currentUserId, ownerId, organizationId: selected.organizationId }) : null };
  }
  const personal = mine.contexts.length === 1 ? mine.contexts[0] : undefined;
  if (personal?.personal && personal.role === ORG_ADMIN_MEMBERSHIP_ROLE && personal.experience === "personal"
    && personal.lifecycle === "active" && personal.organizationId
    && personal.organizationId === mine.personalOrganizationId) {
    return {
      state: "ready",
      userId: currentUserId,
      ownerId,
      tenant: Object.freeze({ kind: "tenant", userId: currentUserId, ownerId, organizationId: personal.organizationId }),
      legacy: mine.legacyPrivateAvailable === true ? Object.freeze({ kind: "legacy", userId: currentUserId, ownerId, organizationId: personal.organizationId }) : null,
    };
  }
  if (mine.contexts.length === 0 && mine.personalOrganizationId === null && mine.legacyPrivateAvailable === true) {
    return { state: "ready", userId: currentUserId, ownerId, tenant: null, legacy: Object.freeze({ kind: "legacy", userId: currentUserId, ownerId }) };
  }
  return { state: "unavailable", userId: currentUserId, ownerId, tenant: null, legacy: null };
}
export function planeAvailable(context: PersonalDataContext, parent?: PersonalDataPlane): boolean {
  if (context.state !== "ready") return false;
  if (!parent) return Boolean(context.tenant ?? context.legacy);
  const available = parent.kind === "tenant" ? context.tenant : context.legacy;
  return Boolean(available && available.userId === parent.userId && available.ownerId === parent.ownerId && available.organizationId === parent.organizationId);
}
/** Capture before a mutation, file read or retry; callers keep this immutable value. */
export function capturePersonalDataPlane(context: PersonalDataContext, parent?: PersonalDataPlane): PersonalDataPlane {
  if (!planeAvailable(context, parent)) throw new Error("PERSONAL_CONTEXT_UNAVAILABLE");
  const plane = parent ?? context.tenant ?? context.legacy!;
  return Object.freeze({ ...plane });
}
export function planeArguments(plane: PersonalDataPlane): { organizationId?: string } {
  return plane.organizationId ? { organizationId: plane.organizationId } : {};
}
export type WithPersonalPlane<Row> = Row & { dataPlane: PersonalDataPlane };
/** Merge only separately authorized results; an absent scoped result never selects legacy. */
export function mergePersonalProjects<Row extends { _id: string; ownerId: string; organizationId?: string; _creationTime: number }>(
  context: PersonalDataContext, scoped: Row[] | null | undefined, legacy: Row[] | null | undefined,
): WithPersonalPlane<Row>[] | undefined {
  if (context.state !== "ready" || (context.tenant && scoped == null) || (context.legacy && legacy == null)) return undefined;
  if (context.tenant && scoped?.some(row => row.ownerId !== context.ownerId || row.organizationId !== context.tenant!.organizationId)) return undefined;
  if (context.legacy && legacy?.some(row => row.ownerId !== context.ownerId || row.organizationId !== undefined)) return undefined;
  const tenantRows = context.tenant ? (scoped ?? []).map(row => ({ ...row, dataPlane: context.tenant! })) : [];
  const legacyRows = context.legacy ? (legacy ?? []).map(row => ({ ...row, dataPlane: context.legacy! })) : [];
  return [...tenantRows, ...legacyRows].sort((a, b) => b._creationTime - a._creationTime || a._id.localeCompare(b._id));
}
