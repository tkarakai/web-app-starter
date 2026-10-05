import { pathToFileURL } from "node:url";

/** A listening socket is not a compiled page. Only a final 2xx response is ready. */
export async function waitForPage(url: string, timeoutMs = 60_000): Promise<void> {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 180_000) throw new Error("Invalid readiness timeout");
  const deadline = Date.now() + timeoutMs;
  let failure = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())), redirect: "follow" });
      await response.body?.cancel();
      if (response.ok) return;
      failure = `HTTP ${response.status}`;
    } catch (error) {
      // A request aborted at the deadline should not hide an HTTP error already observed.
      if (!failure.startsWith("HTTP ") || Date.now() < deadline) failure = String(error);
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(250, Math.max(0, deadline - Date.now()))));
  }
  throw new Error(`${url}: page readiness failed (${failure})`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  waitForPage(process.argv[2], Number(process.env.DEV_READY_TIMEOUT_MS ?? 60_000)).catch(error => {
    console.error(String(error)); process.exitCode = 1;
  });
}
