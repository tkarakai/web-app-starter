import type { NextRequest } from "next/server";

import { handleBetterAuth } from "@/lib/auth";

// Next.js route handler that forwards all requests to BetterAuth.
export async function GET(request: NextRequest) {
  return handleBetterAuth(request);
}

export async function POST(request: NextRequest) {
  return handleBetterAuth(request);
}
