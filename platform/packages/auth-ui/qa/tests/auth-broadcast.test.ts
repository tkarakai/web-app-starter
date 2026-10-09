import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";

// Mock BroadcastChannel since it's a browser API
class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = [];
  name: string;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  listeners = new Set<(event: { data: unknown }) => void>();
  closed = false;

  constructor(name: string) {
    this.name = name;
    MockBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown) {
    // Deliver to other instances with the same channel name (cross-tab simulation)
    for (const instance of MockBroadcastChannel.instances) {
      if (instance !== this && instance.name === this.name && !instance.closed) {
        instance.onmessage?.({ data });
        for (const listener of instance.listeners) listener({ data });
      }
    }
  }

  addEventListener(_type: string, listener: (event: { data: unknown }) => void) {
    this.listeners.add(listener);
  }

  removeEventListener(_type: string, listener: (event: { data: unknown }) => void) {
    this.listeners.delete(listener);
  }

  close() {
    this.closed = true;
    MockBroadcastChannel.instances = MockBroadcastChannel.instances.filter((i) => i !== this);
  }

  static reset() {
    MockBroadcastChannel.instances = [];
  }
}

// Install mock before importing the module
const originalBC = globalThis.BroadcastChannel;
// @ts-expect-error -- mock
globalThis.BroadcastChannel = MockBroadcastChannel;

// Dynamic import so the module picks up the mock
const { broadcastAuth, onAuthBroadcast } = await import("../../src/lib/auth-broadcast");
const cleanups: Array<() => void> = [];
function subscribe(callback: () => void) {
  const cleanup = onAuthBroadcast(callback);
  cleanups.push(cleanup);
  return () => {
    cleanups.splice(cleanups.indexOf(cleanup), 1);
    cleanup();
  };
}
beforeEach(() => {
  // @ts-expect-error -- mock
  globalThis.BroadcastChannel = MockBroadcastChannel;
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  globalThis.BroadcastChannel = originalBC;
});

describe("broadcastAuth", () => {
  beforeEach(() => {
    MockBroadcastChannel.reset();
  });

  afterEach(() => {
    MockBroadcastChannel.reset();
  });

  it("creates a channel, posts 'authenticated', and closes it", () => {
    broadcastAuth();

    // Channel was created and closed (fire-and-forget)
    expect(MockBroadcastChannel.instances).toHaveLength(0); // closed = removed
  });

  it("does not throw when BroadcastChannel is unavailable", () => {
    // @ts-expect-error -- temporarily remove
    globalThis.BroadcastChannel = undefined;

    expect(() => broadcastAuth()).not.toThrow();

    // @ts-expect-error -- restore
    globalThis.BroadcastChannel = MockBroadcastChannel;
  });
});

describe("onAuthBroadcast", () => {
  beforeEach(() => {
    MockBroadcastChannel.reset();
  });

  afterEach(() => {
    MockBroadcastChannel.reset();
  });

  it("calls callback when 'authenticated' message is received", () => {
    const callback = mock(() => {});
    subscribe(callback);

    // Simulate broadcast from another tab
    const sender = new MockBroadcastChannel("auth");
    sender.postMessage("authenticated");
    sender.close();

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("ignores messages that are not 'authenticated'", () => {
    const callback = mock(() => {});
    subscribe(callback);

    // Simulate a different message on a new channel with the same name
    const sender = new MockBroadcastChannel("auth");
    sender.postMessage("something-else");
    sender.close();

    expect(callback).not.toHaveBeenCalled();
  });

  it("returns a cleanup function that closes the channel", () => {
    const callback = mock(() => {});
    const cleanup = subscribe(callback);

    expect(MockBroadcastChannel.instances).toHaveLength(1);

    cleanup();

    expect(MockBroadcastChannel.instances).toHaveLength(0);

    // Messages after cleanup should not trigger callback
    broadcastAuth();
    expect(callback).not.toHaveBeenCalled();
  });

  it("returns a no-op cleanup when BroadcastChannel is unavailable", () => {
    // @ts-expect-error -- temporarily remove
    globalThis.BroadcastChannel = undefined;

    const callback = mock(() => {});
    const cleanup = subscribe(callback);

    expect(() => cleanup()).not.toThrow();

    // @ts-expect-error -- restore
    globalThis.BroadcastChannel = MockBroadcastChannel;
  });

  it("does not deliver its own sign-in broadcast to this document", () => {
    const callback = mock(() => {});
    subscribe(callback);
    broadcastAuth();
    expect(callback).not.toHaveBeenCalled();
  });

  it("keeps other subscribers active when one guest surface unmounts", () => {
    const first = mock(() => {});
    const second = mock(() => {});
    const cleanup = subscribe(first);
    subscribe(second);
    cleanup();
    const sender = new MockBroadcastChannel("auth");
    sender.postMessage("authenticated");
    sender.close();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
