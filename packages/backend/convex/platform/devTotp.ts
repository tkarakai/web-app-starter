import { authorizeFixtureRequest } from "./localFixtures";
import { httpAction } from "../_generated/server";

export const getDevTotpCode = httpAction(async (_ctx, request) => {
  if (!authorizeFixtureRequest(request)) {
    return new Response(JSON.stringify({ error: "Not available" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      message:
        "Use the TOTP code from your authenticator app or server console",
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
});
