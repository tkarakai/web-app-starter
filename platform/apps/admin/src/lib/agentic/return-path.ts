import { validateAuthorization } from "@web-app-starter/agentic/oauth";

export function postSignInPath(): string {
  try {
    const path = new URLSearchParams(window.location.search).get("agent_return");
    if (!path) return "/dashboard";
    const url = new URL(path, window.location.origin);
    if (url.origin !== window.location.origin || url.pathname !== "/settings/agent-access"
      || url.searchParams.get("resource") !== window.location.origin + "/api/mcp") return "/dashboard";
    validateAuthorization(url.searchParams);
    return url.pathname + url.search;
  } catch { return "/dashboard"; }
}

