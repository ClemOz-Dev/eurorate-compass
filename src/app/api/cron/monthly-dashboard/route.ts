import { rebuildDashboardSnapshot } from "@/lib/dashboard/snapshot";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "Missing CRON_SECRET" }, { status: 500 });
  }

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const data = await rebuildDashboardSnapshot();
    return NextResponse.json({
      ok: true,
      refreshedAt: new Date().toISOString(),
      asOf: data.asOf,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Cron rebuild error",
      },
      { status: 500 },
    );
  }
}
