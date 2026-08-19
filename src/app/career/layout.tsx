/**
 * The frame every career screen sits inside: navigation down the left, the
 * state of the season across the top, and the Continue button that drives the
 * whole game loop.
 */

import Link from "next/link";
import { and, eq, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clubs, fixtures } from "@/db/schema";
import { requireCareer } from "@/lib/session";
import { ClubDot } from "@/components/ui/primitives";
import { CareerNav } from "@/components/CareerNav";
import { ContinueButton } from "@/components/ContinueButton";

export const dynamic = "force-dynamic";

export default async function CareerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { career, club } = await requireCareer();
  const seasonOver = career.currentRound > 38;

  // The manager's next fixture, for the header.
  const next = seasonOver
    ? []
    : await db
        .select({
          round: fixtures.round,
          homeClubId: fixtures.homeClubId,
          awayClubId: fixtures.awayClubId,
          opponentName: sql<string>`opponent.name`,
          opponentColor: sql<string>`opponent.primary_color`,
        })
        .from(fixtures)
        .innerJoin(
          sql`${clubs} as opponent`,
          sql`opponent.id = CASE WHEN ${fixtures.homeClubId} = ${career.clubId} THEN ${fixtures.awayClubId} ELSE ${fixtures.homeClubId} END`,
        )
        .where(
          and(
            eq(fixtures.careerId, career.id),
            eq(fixtures.round, career.currentRound),
            or(eq(fixtures.homeClubId, career.clubId), eq(fixtures.awayClubId, career.clubId)),
          ),
        )
        .limit(1);

  const fixture = next[0];
  const isHome = fixture?.homeClubId === career.clubId;

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-48 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-raised)]">
        <Link href="/career/squad" className="block border-b border-[var(--border)] px-3 py-3">
          <span className="flex items-center gap-2">
            <ClubDot color={club.primaryColor} />
            <span className="truncate font-semibold">{club.name}</span>
          </span>
          <span className="mt-0.5 block text-[11px] text-[var(--text-dim)]">
            {career.username}
          </span>
        </Link>

        <CareerNav />

        <div className="mt-auto border-t border-[var(--border)] p-3 text-[11px] text-[var(--text-dim)]">
          Season {career.season}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--bg-raised)] px-4 py-2.5">
          <div className="min-w-0">
            {seasonOver ? (
              <p className="font-medium">The season is complete</p>
            ) : fixture ? (
              <p className="truncate">
                <span className="text-[var(--text-dim)]">Round {career.currentRound} </span>
                <span className="mx-1.5 text-[var(--text-dim)]">·</span>
                <span className="text-[var(--text-muted)]">{isHome ? "at home to" : "away to"} </span>
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <ClubDot color={fixture.opponentColor} />
                  {fixture.opponentName}
                </span>
              </p>
            ) : (
              <p className="text-[var(--text-muted)]">No fixture scheduled</p>
            )}
          </div>

          {!seasonOver && <ContinueButton />}
        </header>

        <main className="min-w-0 flex-1 p-4">{children}</main>
      </div>
    </div>
  );
}
