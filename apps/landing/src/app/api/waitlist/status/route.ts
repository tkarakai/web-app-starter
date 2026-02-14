import { NextResponse } from "next/server";

const CONVEX_SITE_URL =
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "http://localhost:3210";

export async function GET() {
  try {
    const response = await fetch(`${CONVEX_SITE_URL}/api/waitlist/status`, {
      next: { revalidate: 60 },
    });
    const data = (await response.json()) as Record<string, unknown>;
    return NextResponse.json(data);
  } catch {
    // Default to waitlist disabled if backend is unreachable
    return NextResponse.json({ enabled: false });
  }
}
