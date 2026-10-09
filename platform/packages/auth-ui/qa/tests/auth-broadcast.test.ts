import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";

// Mock BroadcastChannel since it's a browser API
class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = [];
  name: string;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false;

  constructor(name: string) {
    this.name = name;
    MockBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown) {
    // BroadcastChannel excludes the sender object, not other objects in its tab.
    for (const instance of MockBroadcastChannel.instances) {
      if (instance !== this && instance.name === this.name && !instance.closed && instance.onmessage) {
        instance.onmessage({ data });
      }
    }
  }

  close() {
    this.closed = true;
    MockBroadcastChannel.instances = MockBroadcastChannel.instances.filter((i) => i !== this);
  }

  static reset() {
    MockBroadcastChannel.instances = [];
  }
}

const originalBC = globalThis.BroadcastChannel;
const { broadcastAuth, onAuthBroadcast } = await import("../../src/lib/auth-broadcast");
const subscriptions: (() => void)[] = [];

beforeEach(() => {
  // @ts-expect-error -- mock
  globalThis.BroadcastChannel = MockBroadcastChannel;
});

afterEach(() => {
  for (const cleanup of subscriptions.splice(0)) cleanup();
  MockBroadcastChannel.reset();
  globalThis.BroadcastChannel = originalBC;
});

function subscribe(callback: () => void) {
  const cleanup = onAuthBroadcast(callback);
  subscriptions.push(cleanup);
  return cleanup;
}

describe("broadcastAuth", () => {
  it("creates a channel, posts 'authenticated', and closes it", () => {
    const receiver = new MockBroadcastChannel("auth");
    receiver.onmessage = mock(() => {});
    broadcastAuth();

    expect(receiver.onmessage).toHaveBeenCalledWith({ data: "authenticated" });
    expect(MockBroadcastChannel.instances).toEqual([receiver]);
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
  it("calls callback when 'authenticated' message is received", () => {
    const callback = mock(() => {});
    subscribe(callback);

    // Simulate broadcast from another tab
    const sender = new MockBroadcastChannel("auth");
    sender.postMessage("authenticated");
    sender.close();

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("notifies other tabs without triggering its own sign-in redirect", () => {
    const callback = mock(() => {});
    subscribe(callback);
    const receiver = new MockBroadcastChannel("auth");
    receiver.onmessage = mock(() => {});

    broadcastAuth();

    expect(callback).not.toHaveBeenCalled();
    expect(receiver.onmessage).toHaveBeenCalledWith({ data: "authenticated" });
  });

  it("keeps remaining subscriptions active and closes after the last cleanup", () => {
    const first = mock(() => {}), second = mock(() => {});
    const cleanupFirst = subscribe(first), cleanupSecond = subscribe(second);
    const sender = new MockBroadcastChannel("auth");
    sender.postMessage("authenticated");
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    cleanupFirst();
    cleanupFirst();
    sender.postMessage("authenticated");
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    broadcastAuth();
    expect(second).toHaveBeenCalledTimes(2);

    cleanupSecond();
    expect(MockBroadcastChannel.instances).toEqual([sender]);
    const third = mock(() => {});
    subscribe(third);
    sender.postMessage("authenticated");
    expect(third).toHaveBeenCalledTimes(1);
  });

  it("cleans up duplicate callbacks as independent subscriptions", () => {
    const callback = mock(() => {});
    const first = subscribe(callback), second = subscribe(callback);
    const sender = new MockBroadcastChannel("auth");
    sender.postMessage("authenticated");
    expect(callback).toHaveBeenCalledTimes(2);
    first();
    sender.postMessage("authenticated");
    expect(callback).toHaveBeenCalledTimes(3);
    second();
    expect(MockBroadcastChannel.instances).toEqual([sender]);
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
});
