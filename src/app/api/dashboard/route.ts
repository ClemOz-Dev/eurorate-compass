import { getDashboardSnapshot, rebuildDashboardSnapshot } from "@/lib/dashboard/snapshot";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const fitWindow = Math.max(24, Number(url.searchParams.get("fitWindow") ?? 84));
  const force = url.searchParams.get("force") === "1";
  try {
    if (!force) {
      const snapshot = await getDashboardSnapshot();
      if (snapshot) return NextResponse.json(snapshot);
    }

    const rebuilt = await rebuildDashboardSnapshot(fitWindow);
    return NextResponse.json(rebuilt);
  } catch (error) {
    const fallback = await getDashboardSnapshot();
    if (fallback) return NextResponse.json(fallback);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown dashboard error",
      },
      { status: 500 },
    );
  }
}

