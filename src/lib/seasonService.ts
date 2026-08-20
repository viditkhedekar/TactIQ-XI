/**
 * Seasons: who is in the division, what happened last year, and the summer.
 *
 * The division is a per-career, per-season fact from the moment a save is
 * created, not a constant. `PL_CLUB_IDS` is only ever the *starting* twenty;
 * after one summer the membership belongs to the save, and everything that
 * needs to know who is in the league reads it from here.
 */

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  careerDivision,
  careerHonours,
  careerPlayerState,
  careers,
  clubs,
  fixtures,
  playerDevelopment,
  players,
  seasonHistory,
  type SeasonHistoryRow,
} from "@/db/schema";
import {
  ROLLOVER,
  ageOneSummer,
  applyPromotionAndRelegation,
  createRng,
  expectationFromStrength,
  hash32,
  squadStrength,
  type TableStanding,
} from "@/engine";
import { CHAMPIONSHIP_CLUB_IDS } from "@/data/lowerClubs";
import { PL_CLUB_IDS } from "@/data/clubs";
import { toAttributeDeltas, toEnginePlayer } from "./engineAdapter";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The clubs in a career's top flight for a season.
 *
 * Falls back to the real twenty when no membership has been recorded, which is
 * what makes this safe to call against saves created before promotion existed.
 */
export async function loadDivision(
  careerId: string,
  season: number,
  tx: Tx | typeof db = db,
): Promise<number[]> {
  const rows = await tx
    .select({ clubId: careerDivision.clubId })
    .from(careerDivision)
    .where(and(eq(careerDivision.careerId, careerId), eq(careerDivision.season, season)));

  return rows.length > 0 ? rows.map((r) => r.clubId) : PL_CLUB_IDS;
}

/** Records who is in the division, replacing whatever was there. */
export async function setDivision(
  tx: Tx,
  careerId: string,
  season: number,
  clubIds: number[],
  promoted: number[] = [],
): Promise<void> {
  await tx
    .delete(careerDivision)
    .where(and(eq(careerDivision.careerId, careerId), eq(careerDivision.season, season)));

  await tx.insert(careerDivision).values(
    clubIds.map((clubId) => ({
      careerId,
      season,
      clubId,
      promoted: promoted.includes(clubId),
    })),
  );
}

/* ----------------------------------------------------------------- tables */

export type StandingRow = {
  clubId: number;
  clubName: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  position: number;
};

/**
 * The league table as it stands, built from finished league fixtures.
 *
 * Cup ties are excluded deliberately: they share the round numbering with the
 * league, so anything that aggregates fixtures without filtering on
 * competition would quietly count them towards the title.
 */
export async function buildLeagueTable(
  careerId: string,
  season: number,
  tx: Tx | typeof db = db,
): Promise<StandingRow[]> {
  const division = await loadDivision(careerId, season, tx);

  const rows = await tx
    .select({
      id: fixtures.id,
      homeClubId: fixtures.homeClubId,
      awayClubId: fixtures.awayClubId,
      homeGoals: fixtures.homeGoals,
      awayGoals: fixtures.awayGoals,
    })
    .from(fixtures)
    .where(
      and(
        eq(fixtures.careerId, careerId),
        eq(fixtures.competition, "league"),
        eq(fixtures.status, "finished"),
      ),
    );

  const clubRows = await tx
    .select({ id: clubs.id, name: clubs.name })
    .from(clubs)
    .where(inArray(clubs.id, division));
  const nameOf = new Map(clubRows.map((c) => [c.id, c.name]));

  const table = new Map<number, StandingRow>();
  for (const clubId of division) {
    table.set(clubId, {
      clubId,
      clubName: nameOf.get(clubId) ?? `Club ${clubId}`,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      points: 0,
      position: 0,
    });
  }

  for (const fixture of rows) {
    if (fixture.homeGoals === null || fixture.awayGoals === null) continue;
    const home = table.get(fixture.homeClubId);
    const away = table.get(fixture.awayClubId);
    if (!home || !away) continue;

    home.played += 1;
    away.played += 1;
    home.goalsFor += fixture.homeGoals;
    home.goalsAgainst += fixture.awayGoals;
    away.goalsFor += fixture.awayGoals;
    away.goalsAgainst += fixture.homeGoals;

    if (fixture.homeGoals > fixture.awayGoals) {
      home.won += 1;
      home.points += 3;
      away.lost += 1;
    } else if (fixture.homeGoals < fixture.awayGoals) {
      away.won += 1;
      away.points += 3;
      home.lost += 1;
    } else {
      home.drawn += 1;
      away.drawn += 1;
      home.points += 1;
      away.points += 1;
    }
  }

  const ordered = [...table.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.goalsFor - b.goalsAgainst - (a.goalsFor - a.goalsAgainst) ||
      b.goalsFor - a.goalsFor ||
      a.clubName.localeCompare(b.clubName),
  );

  return ordered.map((row, index) => ({ ...row, position: index + 1 }));
}

/* -------------------------------------------------------------- the summer */

export type RolloverResult = {
  season: number;
  champion: { clubId: number; clubName: string };
  relegated: { clubId: number; clubName: string }[];
  promoted: { clubId: number; clubName: string }[];
  /** The manager's own finishing position. */
  userPosition: number;
  userRelegated: boolean;
  retirements: { playerId: number; name: string; age: number; clubId: number }[];
  /** Individual awards handed out for the season just finished. */
  awards: { type: string; playerId: number; name: string; value: number }[];
};

/**
 * Everything that happens between the last game of one season and the first of
 * the next: the table is frozen into history, honours are recorded, players age
 * a year, three clubs swap places, and a fresh fixture list is drawn.
 *
 * Written as one transaction because a save caught halfway through this would
 * be unplayable: a division of seventeen, or a season with no fixtures.
 */
export async function rolloverSeason(careerId: string): Promise<RolloverResult> {
  const [career] = await db.select().from(careers).where(eq(careers.id, careerId)).limit(1);
  if (!career) throw new Error("No such career");

  const season = career.season;
  const table = await buildLeagueTable(careerId, season);
  if (table.length === 0) throw new Error("That season has no table to close");

  const rng = createRng(hash32(`${careerId}-rollover-${season}`));

  const standings: TableStanding[] = table.map((row) => ({
    clubId: row.clubId,
    position: row.position,
  }));

  const { relegated, promoted, division } = applyPromotionAndRelegation(
    rng,
    standings,
    CHAMPIONSHIP_CLUB_IDS,
  );

  const userRow = table.find((r) => r.clubId === career.clubId);
  const userPosition = userRow?.position ?? table.length;
  const userRelegated = relegated.includes(career.clubId);

  // Every player in the game ages, not only those in the top flight: a club in
  // the second tier whose squad never got a year older would arrive back in the
  // division with the same players it went down with, forever.
  const allPlayers = await db.select().from(players);
  const states = await db
    .select()
    .from(careerPlayerState)
    .where(eq(careerPlayerState.careerId, careerId));
  const stateById = new Map(states.map((s) => [s.playerId, s]));

  const awards = await seasonAwards(careerId, career.clubId);
  const nameOf = new Map(allPlayers.map((p) => [p.id, p.shortName]));

  const clubRows = await db.select({ id: clubs.id, name: clubs.name }).from(clubs);
  const clubName = new Map(clubRows.map((c) => [c.id, c.name]));

  const retirements: RolloverResult["retirements"] = [];

  await db.transaction(async (tx) => {
    /* ------------------------------------------------------------- history */

    await tx
      .insert(seasonHistory)
      .values(
        table.map((row) => ({
          careerId,
          season,
          clubId: row.clubId,
          position: row.position,
          played: row.played,
          won: row.won,
          drawn: row.drawn,
          lost: row.lost,
          goalsFor: row.goalsFor,
          goalsAgainst: row.goalsAgainst,
          points: row.points,
          outcome:
            row.position === 1
              ? "champion"
              : relegated.includes(row.clubId)
                ? "relegated"
                : null,
        })),
      )
      .onConflictDoNothing();

    /* -------------------------------------------------------------- honours */

    const honours: (typeof careerHonours.$inferInsert)[] = [
      {
        careerId,
        season,
        type: "league_title",
        clubId: table[0].clubId,
        isUser: table[0].clubId === career.clubId,
      },
    ];

    if (table[1]) {
      honours.push({
        careerId,
        season,
        type: "league_runner_up",
        clubId: table[1].clubId,
        isUser: table[1].clubId === career.clubId,
      });
    }

    for (const promotedId of promoted) {
      honours.push({ careerId, season, type: "promoted", clubId: promotedId, isUser: false });
    }

    for (const award of awards) {
      honours.push({
        careerId,
        season,
        type: award.type,
        clubId: award.clubId,
        playerId: award.playerId,
        value: award.value,
        isUser: award.clubId === career.clubId,
      });
    }

    await tx.insert(careerHonours).values(honours);

    /* ---------------------------------------------------------- development */

    // A snapshot per player, which is what the development graph draws.
    const snapshots = allPlayers.map((row) => {
      const state = stateById.get(row.id);
      const engine = toEnginePlayer(row, state);
      return {
        careerId,
        playerId: row.id,
        season,
        overall: Math.round(engine.overall),
        age: engine.age,
        clubId: state?.clubId ?? row.clubId,
      };
    });

    for (let i = 0; i < snapshots.length; i += 400) {
      await tx
        .insert(playerDevelopment)
        .values(snapshots.slice(i, i + 400))
        .onConflictDoNothing();
    }

    /* ------------------------------------------------------------- ageing */

    const updates: {
      playerId: number;
      age: number;
      deltas: Record<string, number>;
      retired: boolean;
    }[] = [];

    for (const row of allPlayers) {
      const state = stateById.get(row.id);
      const engine = toEnginePlayer(row, state);
      const result = ageOneSummer(rng, engine, row.potential);

      const existing = toAttributeDeltas(state?.attributeDeltas) ?? {};
      const merged: Record<string, number> = { ...existing };
      for (const [attribute, delta] of Object.entries(result.deltas)) {
        merged[attribute] = (merged[attribute] ?? 0) + (delta ?? 0);
      }

      updates.push({
        playerId: row.id,
        age: result.age,
        deltas: merged,
        retired: result.retired,
      });

      if (result.retired) {
        retirements.push({
          playerId: row.id,
          name: nameOf.get(row.id) ?? "Unknown",
          age: result.age,
          clubId: state?.clubId ?? row.clubId,
        });
      }
    }

    // Age and the summer's attribute movement both go to career state, never to
    // the shared players row: two saves in one database run at their own pace,
    // and ageing the reference data would drag everybody else's squad along.
    // Retirement is recorded rather than deleted, because career state, honours
    // and old fixtures all still point at the player.
    for (let i = 0; i < updates.length; i += 400) {
      const chunk = updates.slice(i, i + 400);
      await tx
        .insert(careerPlayerState)
        .values(
          chunk.map((u) => ({
            careerId,
            playerId: u.playerId,
            age: u.age,
            attributeDeltas: u.deltas,
            retiredInSeason: u.retired ? season : null,
          })),
        )
        .onConflictDoUpdate({
          target: [careerPlayerState.careerId, careerPlayerState.playerId],
          set: {
            age: sql`excluded.age`,
            attributeDeltas: sql`excluded.attribute_deltas`,
            retiredInSeason: sql`coalesce(excluded.retired_in_season, ${careerPlayerState.retiredInSeason})`,
            // A new season wipes the per-season counters. Career totals are not
            // lost with them: they live in season history and the honours board.
            seasonYellows: sql`0`,
            apps: sql`0`,
            goals: sql`0`,
            assists: sql`0`,
            minutes: sql`0`,
            yellows: sql`0`,
            reds: sql`0`,
            ratingSum: sql`0`,
            ratingCount: sql`0`,
            fitness: sql`100`,
            form: sql`6.5`,
            injuredUntilRound: sql`NULL`,
            suspendedUntilRound: sql`NULL`,
            injuryType: sql`NULL`,
          },
        });
    }

    /* ------------------------------------------------------ the new season */

    await setDivision(tx, careerId, season + 1, division, promoted);

    await tx
      .update(careers)
      .set({
        season: season + 1,
        currentRound: 1,
        phase: "idle",
        updatedAt: new Date(),
      })
      .where(eq(careers.id, careerId));
  });

  return {
    season,
    champion: {
      clubId: table[0].clubId,
      clubName: table[0].clubName,
    },
    relegated: relegated.map((id) => ({ clubId: id, clubName: clubName.get(id) ?? "" })),
    promoted: promoted.map((id) => ({ clubId: id, clubName: clubName.get(id) ?? "" })),
    userPosition,
    userRelegated,
    retirements,
    awards: awards.map((a) => ({
      type: a.type,
      playerId: a.playerId,
      name: nameOf.get(a.playerId) ?? "Unknown",
      value: a.value,
    })),
  };
}

/* ------------------------------------------------------------------ awards */

/** The individual honours for a finished season, from the season's own totals. */
async function seasonAwards(
  careerId: string,
  _userClubId: number,
): Promise<{ type: string; playerId: number; clubId: number; value: number }[]> {
  const rows = await db
    .select({
      playerId: careerPlayerState.playerId,
      clubId: sql<number>`COALESCE(${careerPlayerState.clubId}, ${players.clubId})`,
      goals: careerPlayerState.goals,
      assists: careerPlayerState.assists,
      ratingSum: careerPlayerState.ratingSum,
      ratingCount: careerPlayerState.ratingCount,
    })
    .from(careerPlayerState)
    .innerJoin(players, eq(players.id, careerPlayerState.playerId))
    .where(eq(careerPlayerState.careerId, careerId));

  const awards: { type: string; playerId: number; clubId: number; value: number }[] = [];

  const topScorer = [...rows].sort((a, b) => b.goals - a.goals)[0];
  if (topScorer && topScorer.goals > 0) {
    awards.push({
      type: "golden_boot",
      playerId: topScorer.playerId,
      clubId: topScorer.clubId,
      value: topScorer.goals,
    });
  }

  const topAssists = [...rows].sort((a, b) => b.assists - a.assists)[0];
  if (topAssists && topAssists.assists > 0) {
    awards.push({
      type: "most_assists",
      playerId: topAssists.playerId,
      clubId: topAssists.clubId,
      value: topAssists.assists,
    });
  }

  // Player of the season needs a real body of work behind it, or it goes to
  // somebody who played twice and happened to score.
  const rated = rows
    .filter((r) => r.ratingCount >= 20)
    .map((r) => ({ ...r, average: r.ratingSum / r.ratingCount }))
    .sort((a, b) => b.average - a.average)[0];

  if (rated) {
    awards.push({
      type: "player_of_season",
      playerId: rated.playerId,
      clubId: rated.clubId,
      value: Math.round(rated.average * 100) / 100,
    });
  }

  return awards;
}

/* ------------------------------------------------------------- expectation */

/**
 * Where the board expects the manager to finish, from squad strength across
 * the division as it now stands.
 */
export async function computeExpectation(
  careerId: string,
  season: number,
  userClubId: number,
): Promise<number> {
  const division = await loadDivision(careerId, season);

  const rows = await db
    .select({ player: players, state: careerPlayerState })
    .from(players)
    .innerJoin(
      careerPlayerState,
      and(
        eq(careerPlayerState.playerId, players.id),
        eq(careerPlayerState.careerId, careerId),
      ),
    )
    .where(
      inArray(sql`COALESCE(${careerPlayerState.clubId}, ${players.clubId})`, division),
    );

  const byClub = new Map<number, ReturnType<typeof toEnginePlayer>[]>();
  for (const { player, state } of rows) {
    const clubId = state.clubId ?? player.clubId;
    const list = byClub.get(clubId) ?? [];
    list.push(toEnginePlayer(player, state));
    byClub.set(clubId, list);
  }

  const strengths = division.map((id) => squadStrength(byClub.get(id) ?? []));
  const own = squadStrength(byClub.get(userClubId) ?? []);

  return expectationFromStrength(own, strengths);
}

/* --------------------------------------------------------------- reading */

/** Every completed season's table, newest first. */
export async function loadSeasonHistory(careerId: string): Promise<SeasonHistoryRow[]> {
  return db
    .select()
    .from(seasonHistory)
    .where(eq(seasonHistory.careerId, careerId))
    .orderBy(desc(seasonHistory.season), asc(seasonHistory.position));
}
