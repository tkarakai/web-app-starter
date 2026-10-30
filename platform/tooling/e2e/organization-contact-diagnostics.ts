import type { Page, WebSocket } from "@playwright/test";
import type { ContactObservation } from "./secret-safe-report.ts";

/** Only this test page's contact RPC and matching directory; never retain raw frames. */
export function observeOrganizationContact(page: Page) {
  let disposed = false;
  let incomplete = false;
  let observedProtocol = false;
  let stopped = false;
  let socketsOpened = 0;
  let frames = 0;
  let sends = 0;
  let ambiguous = false;
  let response: "unresolved" | "succeeded" | "rejected" = "unresolved";
  let directory: "unobserved" | "current" | "not-current" | "target-absent" | "error" = "unobserved";
  let target: { socket: WebSocket; requestId: number; organizationId: string; memberId: string } | undefined;
  const sockets = new Map<WebSocket, () => void>();
  const directoryScopes = new Map<WebSocket, Map<number, string | null>>();
  const uncertain = () => { incomplete = true; directory = "unobserved"; };
  const markAmbiguous = () => { ambiguous = true; target = undefined; uncertain(); };
  const overlappingDirectories = () => {
    if (!target) return false;
    let count = 0;
    for (const queries of directoryScopes.values()) for (const organizationId of queries.values()) {
      if (organizationId === target.organizationId && ++count > 1) { uncertain(); return true; }
    }
    return false;
  };
  const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
  const number = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  const identifier = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256;
  const pathIs = (path: unknown, name: string) => path === `platform/memberManagement:${name}` || path === `platform/memberManagement.js:${name}`;
  const detachSockets = () => { for (const detach of [...sockets.values()]) detach(); };
  const stop = () => { uncertain(); stopped = true; detachSockets(); };
  const onSocket = (socket: WebSocket) => {
    if (disposed || stopped) return;
    if (++socketsOpened > 8) { stop(); return; }
    const queries = new Map<number, string | null>();
    directoryScopes.set(socket, queries);
    const queryIds = new Set<number>();
    const requestIds = new Set<number>();
    const read = (frame: { payload: string | Buffer }, consume: (value: Record<string, unknown>) => void) => {
      if (disposed || stopped) return;
      if (++frames > 2048) { stop(); return; }
      try {
        if (!(typeof frame.payload === "string" || Buffer.isBuffer(frame.payload)) || Buffer.byteLength(frame.payload) > 65_536) { uncertain(); return; }
        const value: unknown = JSON.parse(typeof frame.payload === "string" ? frame.payload : frame.payload.toString("utf8"));
        if (!record(value)) { uncertain(); return; }
        consume(value);
      } catch { uncertain(); }
    };
    const sent = (frame: { payload: string | Buffer }) => read(frame, value => {
      if (value.type === "Mutation" || value.type === "Action") {
        if (!number(value.requestId)) { uncertain(); return; }
        observedProtocol = true;
        if (requestIds.has(value.requestId)) {
          uncertain();
          if (target?.socket === socket && target.requestId === value.requestId || pathIs(value.udfPath, "setContact")) markAmbiguous();
        }
        if (requestIds.size >= 128) { stop(); return; }
        requestIds.add(value.requestId);
        if (value.type !== "Mutation" || !pathIs(value.udfPath, "setContact") || value.componentPath !== undefined) return;
        sends = Math.min(sends + 1, 2);
        if (sends !== 1) { markAmbiguous(); return; }
        const args = Array.isArray(value.args) && value.args.length === 1 ? value.args[0] : null;
        if (!record(args) || !identifier(args.organizationId) || !identifier(args.memberId)) { markAmbiguous(); return; }
        target = { socket, requestId: value.requestId, organizationId: args.organizationId, memberId: args.memberId };
        overlappingDirectories();
      }
      if (value.type !== "ModifyQuerySet") return;
      if (!Array.isArray(value.modifications) || value.modifications.length > 128) { uncertain(); return; }
      observedProtocol = true;
      for (const modification of value.modifications) {
        if (!record(modification) || !number(modification.queryId)) { uncertain(); continue; }
        if (modification.type === "Remove") {
          if (target && queries.get(modification.queryId) === target.organizationId) directory = "unobserved";
          queries.delete(modification.queryId); continue;
        }
        if (modification.type !== "Add") { uncertain(); continue; }
        if (queryIds.has(modification.queryId)) { uncertain(); queries.delete(modification.queryId); directory = "unobserved"; continue; }
        if (queryIds.size >= 128) { stop(); return; }
        queryIds.add(modification.queryId);
        let organizationId: string | null = null;
        if (pathIs(modification.udfPath, "directory") && modification.componentPath === undefined) {
          const args = Array.isArray(modification.args) && modification.args.length === 1 ? modification.args[0] : null;
          if (!record(args) || !identifier(args.organizationId)) uncertain();
          else organizationId = args.organizationId;
        }
        queries.set(modification.queryId, organizationId);
        overlappingDirectories();
      }
    });
    const received = (frame: { payload: string | Buffer }) => read(frame, value => {
      // Do not reconstruct chunk payloads or claim coverage over an unseen transition.
      if (value.type === "TransitionChunk" || value.type === "AuthError" || value.type === "FatalError") { uncertain(); return; }
      if (value.type === "MutationResponse" && target?.socket === socket && value.requestId === target.requestId) {
        if (typeof value.success !== "boolean" || response !== "unresolved") { markAmbiguous(); return; }
        response = value.success ? "succeeded" : "rejected";
      }
      if (value.type !== "Transition" || !target || overlappingDirectories()) return;
      if (!Array.isArray(value.modifications) || value.modifications.length > 128) { uncertain(); return; }
      for (const modification of value.modifications) {
        if (!record(modification) || !number(modification.queryId)) { uncertain(); continue; }
        if (queries.get(modification.queryId) !== target.organizationId) continue;
        if (modification.type === "QueryRemoved") { queries.delete(modification.queryId); directory = "unobserved"; continue; }
        if (modification.type === "QueryFailed") { directory = "error"; continue; }
        if (modification.type !== "QueryUpdated" || !record(modification.value) || !Array.isArray(modification.value.page) || modification.value.page.length > 100) {
          uncertain(); continue;
        }
        const page = modification.value.page;
        if (!page.every(row => record(row) && identifier(row.memberId) && typeof row.isContact === "boolean")) { uncertain(); continue; }
        const matches = page.filter(row => row.memberId === target!.memberId);
        if (matches.length > 1) { uncertain(); continue; }
        directory = matches.length === 0 ? "target-absent" : matches[0].isContact ? "current" : "not-current";
      }
    });
    const closed = () => { uncertain(); detach(); };
    const error = () => { uncertain(); };
    const detach = () => {
      for (const remove of [() => socket.off("framesent", sent), () => socket.off("framereceived", received),
        () => socket.off("close", closed), () => socket.off("socketerror", error)]) {
        try { remove(); } catch { uncertain(); }
      }
      queries.clear(); queryIds.clear(); requestIds.clear(); directoryScopes.delete(socket); sockets.delete(socket);
    };
    sockets.set(socket, detach);
    try { socket.on("framesent", sent); socket.on("framereceived", received); socket.on("close", closed); socket.on("socketerror", error); }
    catch { uncertain(); detach(); }
  };
  const dispose = () => {
    disposed = true; target = undefined;
    for (const remove of [() => page.off("websocket", onSocket), () => page.off("close", dispose)]) {
      try { remove(); } catch { uncertain(); }
    }
    detachSockets();
  };
  try { page.on("websocket", onSocket); page.on("close", dispose); }
  catch { uncertain(); }
  return {
    observations(): ContactObservation[] {
      if (disposed || !observedProtocol && !incomplete) return ["org-contact-observer-unavailable"];
      return [incomplete ? "org-contact-observer-incomplete" : "org-contact-observer-complete",
        ambiguous ? "org-contact-rpc-ambiguous" : sends === 0 ? "org-contact-rpc-not-observed"
          : response === "succeeded" ? "org-contact-rpc-succeeded" : response === "rejected" ? "org-contact-rpc-rejected" : "org-contact-rpc-unresolved",
        directory === "current" ? "org-contact-directory-current" : directory === "not-current" ? "org-contact-directory-not-current"
          : directory === "target-absent" ? "org-contact-directory-target-absent" : directory === "error" ? "org-contact-directory-error" : "org-contact-directory-unobserved"];
    },
    dispose,
  };
}
