import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { submissions } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";

// GET /api/submissions — list submissions (optionally filtered by artist)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const artistWallet = searchParams.get("artist");

    const rows = artistWallet
      ? await db
          .select()
          .from(submissions)
          .where(eq(submissions.artistWallet, artistWallet))
          .orderBy(desc(submissions.submittedAt))
      : await db
          .select()
          .from(submissions)
          .orderBy(desc(submissions.submittedAt))
          .limit(50);

    return NextResponse.json({ items: rows });
  } catch (err) {
    console.error("[GET /api/submissions]", err);
    return NextResponse.json(
      { error: "internal_error", message: String(err) },
      { status: 500 }
    );
  }
}
