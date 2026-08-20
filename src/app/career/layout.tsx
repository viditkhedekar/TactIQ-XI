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
import { ClubDot, Button } from "@/components/ui/primitives";
import { ROUNDS_IN_SEASON } from "@/engine";
import { CareerNav } from "@/components/CareerNav";
import { ContinueButton } from "@/components/ContinueButton";
import { signOutAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function CareerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { career, club } = await requireCareer();

  // The two states where the game loop stops and the manager has something to
  // deal with instead. Both replace the Continue button rather than sitting
  // alongside it: there is nothing to continue to until they are resolved.
  const seasonOver = career.phase === "season_over";
  const sacked = career.phase === "sacked";
  const noFixturesLeft = career.currentRound > ROUNDS_IN_SEASON;

  // The manager's next fixture, for the header.
  const next = seasonOver || sacked
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
            eq(fixtures.season, career.season),
            eq(fixtures.competition, "league"),
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

        <form action={signOutAction} className="border-b border-[var(--border)] px-3 py-2">
          <Button type="submit" variant="ghost" size="sm" className="w-full justify-center">
            Log out
          </Button>
        </form>

        <CareerNav />

        <div className="mt-auto border-t border-[var(--border)] p-3 text-[11px] text-[var(--text-dim)]">
          Season {career.season}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--bg-raised)] px-4 py-2.5">
          <div className="min-w-0">
            {sacked ? (
              <p className="font-medium text-[var(--bad)]">You are out of a job</p>
            ) : seasonOver ? (
              <p className="font-medium">Season {career.season} is complete</p>
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

          {sacked ? (
            <Link
              href="/career/board"
              className="rounded border border-[var(--bad)] px-3 py-1.5 text-[12px] font-medium text-[var(--bad)] transition-colors hover:bg-[rgba(248,81,73,0.12)]"
            >
              See who wants you
            </Link>
          ) : seasonOver ? (
            <Link
              href="/career/season"
              className="rounded border border-[var(--accent)] bg-[var(--accent-dim)] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-[var(--accent)]"
            >
              Season review
            </Link>
          ) : noFixturesLeft ? null : (
            <ContinueButton />
          )}
        </header>

        <main className="min-w-0 flex-1 p-4">{children}</main>
      </div>
    </div>
  );
}
