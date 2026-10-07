import { afterEach, expect, spyOn, test } from "bun:test";
import { authenticate } from "../src/auth";
const previous = process.env.AGENT_NO_OPEN;
afterEach(() => { if (previous === undefined) delete process.env.AGENT_NO_OPEN; else process.env.AGENT_NO_OPEN = previous; });

test("explicit browser denial verifies state and closes the loopback authorization flow", async () => {
  process.env.AGENT_NO_OPEN = "true";
  let receive!: (url: URL) => void;
  const requested = new Promise<URL>(resolve => { receive = resolve; });
  const output = spyOn(process.stdout, "write").mockImplementation(chunk => {
    const url = String(chunk).split("\n").find(line => line.startsWith("http://localhost:3002/api/agent/authorize?"));
    if (url) receive(new URL(url));
    return true;
  });
  const outcome = authenticate("http://localhost:3002").then(() => "unexpected grant", error => error instanceof Error ? error.message : "error");
  try {
    const request = await requested;
    const callback = new URL(request.searchParams.get("redirect_uri")!);
    callback.search = new URLSearchParams({ error: "access_denied", state: "wrong-state" }).toString();
    expect((await fetch(callback)).status).toBe(400);
    callback.searchParams.set("state", request.searchParams.get("state")!);
    const response = await fetch(callback);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("No authorization was granted");
    expect(await outcome).toContain("Announcement access was denied");
  } finally { output.mockRestore(); }
});
