import { redirect } from "next/navigation";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/db/client";
import { clubs, fixtures } from "@/db/schema";
import { requireCareer } from "@/lib/session";
import { MatchDay } from "@/components/match/MatchDay";

export const dynamic = "force-dynamic";

export default async function MatchPage() {
  const { career } = await requireCareer();

  if (career.currentRound > 38) redirect("/career/table");

  // Club colours are the one thing the match screen needs that the engine does
  // not carry, so they are fetched here rather than pushed through the API.
  const [fixture] = await db
    .select({
      homeClubId: fixtures.homeClubId,
      awayClubId: fixtures.awayClubId,
    })
    .from(fixtures)
    .where(
      and(
        eq(fixtures.careerId, career.id),
        eq(fixtures.season, career.season),
        eq(fixtures.competition, "league"),
        eq(fixtures.round, career.currentRound),
        or(eq(fixtures.homeClubId, career.clubId), eq(fixtures.awayClubId, career.clubId)),
      ),
    )
    .limit(1);

  if (!fixture) redirect("/career/fixtures");

  const colors = await db.select({ id: clubs.id, color: clubs.primaryColor }).from(clubs);
  const colorById = new Map(colors.map((c) => [c.id, c.color]));

  return (
    <MatchDay
      homeColor={colorById.get(fixture.homeClubId)}
      awayColor={colorById.get(fixture.awayClubId)}
    />
  );
}
