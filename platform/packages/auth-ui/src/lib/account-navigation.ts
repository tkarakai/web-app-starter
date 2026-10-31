import { allLocales } from "@web-app-starter/i18n/config";

const HOME = "/dashboard";

function withoutLocale(pathname: string): string {
  const parts = pathname.split("/");
  return allLocales.some(locale => locale === parts[1]) ? `/${parts.slice(2).join("/")}` : pathname;
}

function isAccountPage(pathname: string): boolean {
  return ["settings", "organization"].some(page => pathname === `${HOME}/${page}` || pathname.startsWith(`${HOME}/${page}/`));
}

/** Only an app workspace can be an account screen's return target; never an external URL or another account screen. */
export function accountReturnPath(candidate: string | null): string {
  if (!candidate?.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) return HOME;
  try {
    const url = new URL(candidate, "https://account-return.invalid");
    if (url.origin !== "https://account-return.invalid") return HOME;
    const path = withoutLocale(url.pathname);
    const decoded = decodeURIComponent(path);
    if (path !== HOME && !path.startsWith(`${HOME}/`)) return HOME;
    const hasControl = Array.from(decoded).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
    if (decoded.includes("\\") || hasControl) return HOME;
    const normalized = new URL(decoded, "https://account-return.invalid").pathname;
    if ((normalized !== HOME && !normalized.startsWith(`${HOME}/`)) || isAccountPage(normalized)) return HOME;
    return `${path}${url.search}${url.hash}`;
  } catch {
    return HOME;
  }
}

/** Keep the original workspace when moving between Settings and Organization, including their nested pages. */
export function accountPageHref(page: "settings" | "organization", pathname: string, search: string, hash = ""): string {
  const origin = isAccountPage(withoutLocale(pathname))
    ? new URLSearchParams(search).get("returnTo")
    : `${pathname}${search ? `?${search}` : ""}${hash}`;
  return `${HOME}/${page}?${new URLSearchParams({ returnTo: accountReturnPath(origin) })}`;
}
