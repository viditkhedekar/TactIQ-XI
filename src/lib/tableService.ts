/**
 * The league table and season statistics.
 *
 * The table is derived from finished fixtures every time it is asked for
 * rather than stored. It is one query over at most 380 rows, and it can never
 * disagree with the results it is built from, which a stored table eventually
 * would.
 */

import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { careerPlayerState, clubs, fixtures, players } from "@/db/schema";

export type TableRow = {
  clubId: number;
  name: string;
  shortName: string;
  primaryColor: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  form: ("W" | "D" | "L")[];
};

export async function loadTable(careerId: string): Promise<TableRow[]> {
  const [clubRows, finished] = await Promise.all([
    db.select().from(clubs).orderBy(asc(clubs.name)),
    db
      .select({
        round: fixtures.round,
        homeClubId: fixtures.homeClubId,
        awayClubId: fixtures.awayClubId,
        homeGoals: fixtures.homeGoals,
        awayGoals: fixtures.awayGoals,
      })
      .from(fixtures)
      .where(and(eq(fixtures.careerId, careerId), eq(fixtures.status, "finished")))
      .orderBy(asc(fixtures.round)),
  ]);

  const rows = new Map<number, TableRow>();
  for (const club of clubRows) {
    rows.set(club.id, {
      clubId: club.id,
      name: club.name,
      shortName: club.shortName,
      primaryColor: club.primaryColor,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0,
      form: [],
    });
  }

  for (const f of finished) {
    if (f.homeGoals === null || f.awayGoals === null) continue;
    const home = rows.get(f.homeClubId);
    const away = rows.get(f.awayClubId);
    if (!home || !away) continue;

    home.played++;
    away.played++;
    home.goalsFor += f.homeGoals;
    home.goalsAgainst += f.awayGoals;
    away.goalsFor += f.awayGoals;
    away.goalsAgainst += f.homeGoals;

    if (f.homeGoals > f.awayGoals) {
      home.won++;
      away.lost++;
      home.points += 3;
      home.form.push("W");
      away.form.push("L");
    } else if (f.homeGoals < f.awayGoals) {
      away.won++;
      home.lost++;
      away.points += 3;
      away.form.push("W");
      home.form.push("L");
    } else {
      home.drawn++;
      away.drawn++;
      home.points++;
      away.points++;
      home.form.push("D");
      away.form.push("D");
    }
  }

  for (const row of rows.values()) {
    row.goalDifference = row.goalsFor - row.goalsAgainst;
    // Only the last five matter for the form guide.
    row.form = row.form.slice(-5);
  }

  return [...rows.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.goalDifference - a.goalDifference ||
      b.goalsFor - a.goalsFor ||
      a.name.localeCompare(b.name),
  );
}

export type LeaderRow = {
  playerId: number;
  name: string;
  clubName: string;
  clubColor: string;
  value: number;
  apps: number;
};

/** Season leaderboards, drawn from the per-career player state. */
export async function loadLeaders(
  careerId: string,
  metric: "goals" | "assists" | "rating",
  limit = 15,
): Promise<LeaderRow[]> {
  const base = db
    .select({
      playerId: players.id,
      name: players.shortName,
      clubName: clubs.name,
      clubColor: clubs.primaryColor,
      apps: careerPlayerState.apps,
      goals: careerPlayerState.goals,
      assists: careerPlayerState.assists,
      rating: sql<number>`round((${careerPlayerState.ratingSum} / nullif(${careerPlayerState.ratingCount}, 0))::numeric, 2)`,
    })
    .from(careerPlayerState)
    .innerJoin(players, eq(players.id, careerPlayerState.playerId))
    .innerJoin(clubs, eq(clubs.id, players.clubId))
    .where(
      metric === "rating"
        ? // A high average from two appearances is noise, not form.
          and(eq(careerPlayerState.careerId, careerId), sql`${careerPlayerState.apps} >= 5`)
        : and(eq(careerPlayerState.careerId, careerId), gt(careerPlayerState[metric], 0)),
    );

  const orderBy =
    metric === "goals"
      ? [desc(careerPlayerState.goals), desc(careerPlayerState.assists)]
      : metric === "assists"
        ? [desc(careerPlayerState.assists), desc(careerPlayerState.goals)]
        : [
            desc(
              sql`${careerPlayerState.ratingSum} / nullif(${careerPlayerState.ratingCount}, 0)`,
            ),
          ];

  const rows = await base.orderBy(...orderBy).limit(limit);

  return rows.map((row) => ({
    playerId: row.playerId,
    name: row.name,
    clubName: row.clubName,
    clubColor: row.clubColor,
    apps: row.apps,
    value: metric === "goals" ? row.goals : metric === "assists" ? row.assists : Number(row.rating),
  }));
}

export type FixtureListRow = {
  id: string;
  round: number;
  kickoffDate: string | null;
  status: string;
  homeClubId: number;
  awayClubId: number;
  homeName: string;
  awayName: string;
  homeColor: string;
  awayColor: string;
  homeGoals: number | null;
  awayGoals: number | null;
};

/** Every fixture in the season, with both clubs resolved. */
export async function loadFixtures(careerId: string): Promise<FixtureListRow[]> {
  const home = clubs;
  const rows = await db
    .select({
      id: fixtures.id,
      round: fixtures.round,
      kickoffDate: fixtures.kickoffDate,
      status: fixtures.status,
      homeClubId: fixtures.homeClubId,
      awayClubId: fixtures.awayClubId,
      homeGoals: fixtures.homeGoals,
      awayGoals: fixtures.awayGoals,
      homeName: home.name,
      homeColor: home.primaryColor,
      awayName: sql<string>`away.name`,
      awayColor: sql<string>`away.primary_color`,
    })
    .from(fixtures)
    .innerJoin(home, eq(home.id, fixtures.homeClubId))
    .innerJoin(sql`${clubs} as away`, sql`away.id = ${fixtures.awayClubId}`)
    .where(eq(fixtures.careerId, careerId))
    .orderBy(asc(fixtures.round), asc(home.name));

  return rows;
}

/** Results already played, most recent first. */
export async function loadRecentResults(
  careerId: string,
  limit = 20,
): Promise<FixtureListRow[]> {
  const all = await loadFixtures(careerId);
  return all
    .filter((f) => f.status === "finished")
    .sort((a, b) => b.round - a.round)
    .slice(0, limit);
}
