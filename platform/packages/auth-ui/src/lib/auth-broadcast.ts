const CHANNEL_NAME = "auth";
let channel: BroadcastChannel | undefined;
const listeners = new Set<() => void>();

/** Notify other tabs that the user just authenticated. */
export function broadcastAuth(): void {
  try {
    // Reuse this tab's listening channel: BroadcastChannel excludes only the
    // sending object, so a second channel would notify our own GuestGuard too.
    const ch = channel ?? new BroadcastChannel(CHANNEL_NAME);
    try {
      ch.postMessage("authenticated");
    } finally {
      if (ch !== channel) ch.close();
    }
  } catch {
    // BroadcastChannel unavailable (e.g. SSR or unsupported browser).
  }
}

/** Subscribe to auth broadcasts from other tabs. Returns a cleanup function. */
export function onAuthBroadcast(callback: () => void): () => void {
  try {
    if (!channel) {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event) => {
        if (event.data === "authenticated") {
          for (const listener of [...listeners]) listener();
        }
      };
    }
    // Each subscription owns its cleanup even if callbacks are identical.
    const listener = () => callback();
    listeners.add(listener);
    return () => {
      if (!listeners.delete(listener)) return;
      if (listeners.size === 0) {
        channel?.close();
        channel = undefined;
      }
    };
  } catch {
    return () => {};
  }
}
