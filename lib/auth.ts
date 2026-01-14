import { NextResponse, type NextRequest } from "next/server";

// Thin wrapper around BetterAuth with safe fallbacks for local onboarding.
export async function handleBetterAuth(request: NextRequest) {
  const moduleExports = (await import("better-auth")) as {
    [key: string]: any;
  };
  const createAuth =
    moduleExports.betterAuth ||
    moduleExports.createAuth ||
    moduleExports.default;

  if (!createAuth) {
    return NextResponse.json(
      {
        error:
          "BetterAuth export not found. Check the BetterAuth version in package.json.",
      },
      { status: 501 }
    );
  }

  const auth = createAuth({
    secret: process.env.BETTER_AUTH_SECRET ?? "dev-secret",
    baseURL: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    database: {
      provider: "convex",
      url:
        process.env.CONVEX_AUTH_URL ??
        process.env.NEXT_PUBLIC_CONVEX_URL ??
        "",
    },
  });

  if (typeof auth?.handler === "function") {
    return auth.handler(request);
  }

  if (typeof auth?.handleRequest === "function") {
    return auth.handleRequest(request);
  }

  return NextResponse.json(
    { error: "BetterAuth handler not configured." },
    { status: 501 }
  );
}
