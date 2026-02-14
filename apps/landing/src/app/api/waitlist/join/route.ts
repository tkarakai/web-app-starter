import { type NextRequest, NextResponse } from "next/server";

const CONVEX_SITE_URL =
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "http://localhost:3210";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await fetch(`${CONVEX_SITE_URL}/api/waitlist/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = (await response.json()) as Record<string, unknown>;
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json(
      { error: "SERVICE_UNAVAILABLE" },
      { status: 503 }
    );
  }
}
