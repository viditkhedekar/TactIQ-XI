/**
 * Landing page: pick a name, pick a club, start managing.
 *
 * Entering a name that already has a career resumes it, which is the whole of
 * the sign-in flow. The club grid is only needed for a new career, so the form
 * makes it optional and the server decides which case this is.
 */

import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { clubs, players } from "@/db/schema";
import { asc, eq, sql } from "drizzle-orm";
import { getCareer } from "@/lib/session";
import { StartCareerForm } from "@/components/StartCareerForm";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  // Someone with a career in progress goes straight back to it.
  const existing = await getCareer();
  if (existing) redirect("/career/squad");

  const rows = await db
    .select({
      id: clubs.id,
      name: clubs.name,
      shortName: clubs.shortName,
      primaryColor: clubs.primaryColor,
      secondaryColor: clubs.secondaryColor,
      squadSize: sql<number>`count(${players.id})::int`,
      // The average of the best sixteen, which is the same measure the engine
      // uses for squad strength, so the stars match the difficulty.
      strength: sql<number>`(
        SELECT round(avg(best.overall))::int
        FROM (
          SELECT p2.overall FROM players p2
          WHERE p2.club_id = ${clubs.id}
          ORDER BY p2.overall DESC LIMIT 16
        ) AS best
      )`,
    })
    .from(clubs)
    .leftJoin(players, eq(players.clubId, clubs.id))
    .groupBy(clubs.id)
    .orderBy(asc(clubs.name));

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Touchline</h1>
        <p className="mt-2 max-w-xl text-[var(--text-muted)]">
          Take charge of a Premier League club for a full season. Pick your side, set your
          tactics, and follow every match minute by minute.
        </p>
      </header>

      <StartCareerForm clubs={rows} />

      <footer className="mt-10 text-[11px] text-[var(--text-dim)]">
        Your career is remembered by the name you enter. Anyone who knows that name can pick
        up where you left off, so treat it as a label rather than a password.
      </footer>
    </main>
  );
}
