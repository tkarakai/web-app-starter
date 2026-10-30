export const CLIENT_ID = "pi-announcements";
/** Deprecated app-operator scope wire identifier; preserve PKCE/consent/exchange compatibility. */
export const SCOPE = "admin:manage";
export function validateAuthorization(params: URLSearchParams) {
  const redirectUri = params.get("redirect_uri") ?? "";
  const redirect = new URL(redirectUri);
  const challenge = params.get("code_challenge") ?? "";
  const state = params.get("state") ?? "";
  if (params.get("client_id") !== CLIENT_ID || params.get("response_type") !== "code"
    || params.get("code_challenge_method") !== "S256" || params.get("scope") !== SCOPE
    || !/^[A-Za-z0-9_-]{43}$/.test(challenge) || !/^[A-Za-z0-9_-]{32,128}$/.test(state)
    || redirect.protocol !== "http:" || redirect.hostname !== "127.0.0.1" || !redirect.port
    || redirect.pathname !== "/callback" || redirect.search || redirect.hash || redirect.username || redirect.password)
    throw new Error("Invalid authorization request");
  return { clientId: CLIENT_ID, redirectUri, challenge, scope: SCOPE, state };
}
export function bearer(headers: Headers): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]{64})$/i.exec(headers.get("authorization") ?? "");
  return match?.[1] ?? null;
}
