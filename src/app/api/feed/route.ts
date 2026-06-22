import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { submissions, ratings } from "@/lib/schema";
import { eq, sql, desc, and } from "drizzle-orm";

// GET /api/feed — list published submissions with aggregate ratings
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const mood = searchParams.get("mood");
    const minSolo = searchParams.get("minSolo");

    // Submissions with status='published' and at least 3 ratings
    const rows = await db
      .select({
        id: submissions.id,
        title: submissions.title,
        artistName: submissions.artistName,
        versionType: submissions.versionType,
        genre: submissions.genre,
        mood: submissions.artistMood,
        coverSvg: submissions.coverSvg,
        publishedAt: submissions.publishedAt,
        ratingCount: submissions.ratingCount,
      })
      .from(submissions)
      .where(eq(submissions.status, "published"))
      .orderBy(desc(submissions.publishedAt))
      .limit(50);

    // Aggregate ratings per submission
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) {
      return NextResponse.json({ items: [] });
    }

    const aggregates = await db
      .select({
        submissionId: ratings.submissionId,
        avgSoloIntensity: sql<number>`avg(${ratings.soloIntensity})::float`,
        avgVocalQuality: sql<number>`avg(${ratings.vocalQuality})::float`,
        tempo: sql<string>`mode() within group (order by ${ratings.tempoFeel})`,
      })
      .from(ratings)
      .where(sql`${ratings.submissionId} = ANY(${ids})`)
      .groupBy(ratings.submissionId);

    const aggMap = new Map(aggregates.map((a) => [a.submissionId, a]));

    let items = rows.map((r) => ({
      ...r,
      ratings: aggMap.get(r.id) ?? null,
    }));

    if (mood) {
      items = items.filter((i) =>
        (i.mood ?? "").toLowerCase().includes(mood.toLowerCase())
      );
    }
    if (minSolo) {
      const min = parseFloat(minSolo);
      items = items.filter(
        (i) => (i.ratings?.avgSoloIntensity ?? 0) >= min
      );
    }

    return NextResponse.json({ items });
  } catch (err) {
    console.error("[GET /api/feed]", err);
    return NextResponse.json(
      { error: "internal_error", message: String(err) },
      { status: 500 }
    );
  }
}
