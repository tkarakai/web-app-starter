const CHANNEL_NAME = "auth";
let receivingChannel: BroadcastChannel | undefined;
let subscribers = 0;

/** Notify other tabs that the user just authenticated. */
export function broadcastAuth(): void {
  try {
    // Sending on the receiving channel excludes this document from delivery.
    const ch = receivingChannel ?? new BroadcastChannel(CHANNEL_NAME);
    ch.postMessage("authenticated");
    if (ch !== receivingChannel) ch.close();
  } catch {
    // BroadcastChannel unavailable (e.g. SSR or unsupported browser).
  }
}

/** Subscribe to auth broadcasts from other tabs. Returns a cleanup function. */
export function onAuthBroadcast(callback: () => void): () => void {
  try {
    const ch = receivingChannel ?? new BroadcastChannel(CHANNEL_NAME);
    receivingChannel = ch;
    subscribers++;
    const handler = (event: MessageEvent) => {
      if (event.data === "authenticated") {
        callback();
      }
    };
    ch.addEventListener("message", handler);
    return () => {
      ch.removeEventListener("message", handler);
      if (--subscribers === 0) {
        ch.close();
        receivingChannel = undefined;
      }
    };
  } catch {
    return () => {};
  }
}
