/**
 * The cup, as fixtures in the database.
 *
 * A cup round is drawn only when the previous one has been played, because the
 * draw depends on who survived. That is why there is no "generate the whole
 * cup" function to match the league's schedule generator: the bracket is built
 * a round at a time, on the way past.
 *
 * Cup ties share the league's round numbering so that "what is on this week" is
 * one query. What separates them is `competition`, and every league query in
 * the codebase filters on it for that reason.
 */

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  careerHonours,
  clubs,
  fixtures,
  type FixtureRow,
} from "@/db/schema";
import {
  CUP,
  createRng,
  cupRoundForLeagueRound,
  cupRoundName,
  drawRound,
  hash32,
  leagueRoundForCupRound,
  selectEntrants,
} from "@/engine";
import { CUP_CLUB_IDS } from "@/data/lowerClubs";
import { fixturesInSeason, loadDivision } from "./seasonService";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Whether a club is from below the top flight, for giant-killing purposes. */
export function isLowerLeague(clubId: number, division: number[]): boolean {
  return !division.includes(clubId);
}

/**
 * Draws a cup round, if one is due this week and has not been drawn already.
 *
 * Returns the ties created, or an empty list when there is nothing to draw.
 * Safe to call every round: it is a no-op in the weeks between cup rounds.
 */
export async function ensureCupRound(
  tx: Tx,
  careerId: string,
  season: number,
  round: number,
): Promise<FixtureRow[]> {
  const cupRound = cupRoundForLeagueRound(round);
  if (cupRound === null) return [];

  const existing = await tx
    .select()
    .from(fixtures)
    .where(
      and(
        fixturesInSeason(careerId, season),
        eq(fixtures.competition, "cup"),
        eq(fixtures.cupRound, cupRound),
        eq(fixtures.round, round),
      ),
    );

  if (existing.length > 0) return existing;

  const rng = createRng(hash32(`${careerId}-cup-${season}-${cupRound}`));

  const survivors =
    cupRound === 1
      ? selectEntrants(rng, await loadDivision(careerId, season, tx), CUP_CLUB_IDS)
      : await winnersOfRound(tx, careerId, season, cupRound - 1);

  if (survivors.length < 2) return [];

  const ties = drawRound(rng, survivors, cupRound);

  const rows = ties.map((tie) => ({
    careerId,
    season,
    round,
    competition: "cup",
    cupRound,
    homeClubId: tie.homeClubId,
    awayClubId: tie.awayClubId,
    seed: hash32(`${careerId}-cup-${season}-${cupRound}-${tie.homeClubId}`) & 0x7fffffff,
  }));

  return tx.insert(fixtures).values(rows).returning();
}

/** Who went through from a given cup round. */
async function winnersOfRound(
  tx: Tx,
  careerId: string,
  season: number,
  cupRound: number,
): Promise<number[]> {
  const rows = await tx
    .select({
      winnerClubId: fixtures.winnerClubId,
      homeClubId: fixtures.homeClubId,
      awayClubId: fixtures.awayClubId,
      homeGoals: fixtures.homeGoals,
      awayGoals: fixtures.awayGoals,
    })
    .from(fixtures)
    .where(
      and(
        fixturesInSeason(careerId, season),
        eq(fixtures.competition, "cup"),
        eq(fixtures.cupRound, cupRound),
        eq(fixtures.status, "finished"),
      ),
    );

  return rows
    .map((row) => {
      // `winnerClubId` is authoritative and is always set on a settled tie,
      // including one that went to penalties. The goal comparison is only a
      // fallback for a row written before it existed.
      if (row.winnerClubId !== null) return row.winnerClubId;
      if (row.homeGoals === null || row.awayGoals === null) return null;
      return row.homeGoals >= row.awayGoals ? row.homeClubId : row.awayClubId;
    })
    .filter((id): id is number => id !== null);
}

export type CupProgress = {
  roundsWon: number;
  totalRounds: number;
  won: boolean;
  /** Knocked out by a club from below the division. */
  giantKilled: boolean;
  /** Still in it. */
  stillIn: boolean;
  /** How far they got, in words. */
  reached: string | null;
};

/**
 * How a club's cup campaign has gone.
 *
 * Derived from the fixtures rather than tracked separately, so it cannot drift
 * out of step with what actually happened on the pitch.
 */
export async function cupProgressFor(
  careerId: string,
  season: number,
  clubId: number,
  tx: Tx | typeof db = db,
): Promise<CupProgress> {
  const ties = await tx
    .select()
    .from(fixtures)
    .where(
      and(
        fixturesInSeason(careerId, season),
        eq(fixtures.competition, "cup"),
        sql`(${fixtures.homeClubId} = ${clubId} OR ${fixtures.awayClubId} = ${clubId})`,
      ),
    )
    .orderBy(asc(fixtures.cupRound));

  if (ties.length === 0) {
    // Zero total rounds is the signal that the competition has not begun, which
    // the board reads as "nothing to judge" rather than as an early exit.
    return {
      roundsWon: 0,
      totalRounds: 0,
      won: false,
      giantKilled: false,
      stillIn: false,
      reached: null,
    };
  }

  const division = await loadDivision(careerId, season, tx);

  let roundsWon = 0;
  let giantKilled = false;
  let eliminated = false;

  for (const tie of ties) {
    if (tie.status !== "finished") continue;

    const won = tie.winnerClubId === clubId;
    if (won) {
      roundsWon += 1;
      continue;
    }

    eliminated = true;
    const opponent = tie.homeClubId === clubId ? tie.awayClubId : tie.homeClubId;
    if (isLowerLeague(opponent, division)) giantKilled = true;
    break;
  }

  const lastPlayed = ties.filter((t) => t.status === "finished").at(-1);

  return {
    roundsWon,
    totalRounds: CUP.rounds,
    won: roundsWon === CUP.rounds,
    giantKilled,
    stillIn: !eliminated && roundsWon < CUP.rounds,
    reached: lastPlayed?.cupRound ? cupRoundName(lastPlayed.cupRound) : null,
  };
}

/** Records the cup winner and runner-up once the final has been played. */
export async function recordCupHonours(
  tx: Tx,
  careerId: string,
  season: number,
  userClubId: number,
): Promise<void> {
  const [final] = await tx
    .select()
    .from(fixtures)
    .where(
      and(
        fixturesInSeason(careerId, season),
        eq(fixtures.competition, "cup"),
        eq(fixtures.cupRound, CUP.rounds),
        eq(fixtures.status, "finished"),
      ),
    )
    .limit(1);

  if (!final || final.winnerClubId === null) return;

  const loser =
    final.winnerClubId === final.homeClubId ? final.awayClubId : final.homeClubId;

  await tx
    .insert(careerHonours)
    .values([
      {
        careerId,
        season,
        type: "cup_winner",
        clubId: final.winnerClubId,
        isUser: final.winnerClubId === userClubId,
      },
      {
        careerId,
        season,
        type: "cup_runner_up",
        clubId: loser,
        isUser: loser === userClubId,
      },
    ]);
}

/** The whole cup for a season, for the fixtures screen. */
export async function loadCupBracket(careerId: string, season: number) {
  const rows = await db
    .select({
      id: fixtures.id,
      cupRound: fixtures.cupRound,
      round: fixtures.round,
      status: fixtures.status,
      homeClubId: fixtures.homeClubId,
      awayClubId: fixtures.awayClubId,
      homeGoals: fixtures.homeGoals,
      awayGoals: fixtures.awayGoals,
      winnerClubId: fixtures.winnerClubId,
      penaltyShootout: fixtures.penaltyShootout,
    })
    .from(fixtures)
    .where(and(fixturesInSeason(careerId, season), eq(fixtures.competition, "cup")))
    .orderBy(asc(fixtures.cupRound));

  if (rows.length === 0) return [];

  const clubIds = [...new Set(rows.flatMap((r) => [r.homeClubId, r.awayClubId]))];
  const clubRows = await db
    .select({ id: clubs.id, name: clubs.name, primaryColor: clubs.primaryColor })
    .from(clubs)
    .where(inArray(clubs.id, clubIds));
  const byId = new Map(clubRows.map((c) => [c.id, c]));

  return rows.map((row) => ({
    ...row,
    roundName: cupRoundName(row.cupRound ?? 0),
    home: byId.get(row.homeClubId),
    away: byId.get(row.awayClubId),
  }));
}

export { leagueRoundForCupRound, cupRoundName };
