/**
 * Creating and loading careers.
 *
 * A career is one manager's save: a club, a fixture list, a squad in a
 * particular condition, and a saved team sheet. Creating one writes all of
 * that in a single transaction so a half-built save can never be left behind.
 */

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  careerClubFinance,
  careerPlayerState,
  careerTactics,
  careerTraining,
  careers,
  clubs,
  fixtures,
  players,
  type CareerRow,
  type ClubRow,
  type PlayerRow,
} from "@/db/schema";
import {
  DEFAULT_SEASON_START,
  chooseFormation,
  createRng,
  generateSchedule,
  hash32,
  roundDate,
  selectLineup,
  squadStrength,
  type EnginePlayer,
  type Slot,
} from "@/engine";
import { toEnginePlayer } from "./engineAdapter";
import { PL_CLUB_IDS } from "@/data/clubs";

export type CareerContext = {
  career: CareerRow;
  club: ClubRow;
};

/** Looks up a career by id, with its club. */
export async function loadCareer(careerId: string): Promise<CareerContext | null> {
  const rows = await db
    .select({ career: careers, club: clubs })
    .from(careers)
    .innerJoin(clubs, eq(clubs.id, careers.clubId))
    .where(eq(careers.id, careerId))
    .limit(1);

  return rows[0] ?? null;
}

export async function findCareerByUsername(username: string): Promise<CareerRow | null> {
  const rows = await db.select().from(careers).where(eq(careers.username, username)).limit(1);
  return rows[0] ?? null;
}

/**
 * Creates a career: the save row, a starting condition for every player in the
 * league, a full fixture list, and a sensible first team sheet.
 *
 * Player state is created for all 547 players, not just the manager's squad,
 * because the other nineteen clubs pick up injuries and suspensions too and
 * their squads have to carry between rounds the same way.
 */
export async function createCareer(username: string, clubId: number): Promise<CareerRow> {
  return db.transaction(async (tx) => {
    const [career] = await tx.insert(careers).values({ username, clubId }).returning();

    const allPlayers = await tx.select().from(players);

    await tx.insert(careerPlayerState).values(
      allPlayers.map((p) => ({ careerId: career.id, playerId: p.id })),
    );

    // Fixtures. The seed is derived from the career and the pairing, so a
    // given match in a given save always plays out the same way.
    const rng = createRng(hash32(career.id));
    const schedule = generateSchedule(PL_CLUB_IDS, rng);

    await tx.insert(fixtures).values(
      schedule.map((f) => ({
        careerId: career.id,
        round: f.round,
        homeClubId: f.homeClubId,
        awayClubId: f.awayClubId,
        kickoffDate: roundDate(DEFAULT_SEASON_START, f.round).toISOString().slice(0, 10),
        seed: hash32(`${career.id}-${f.round}-${f.homeClubId}-${f.awayClubId}`) & 0x7fffffff,
      })),
    );

    // A first team sheet, so the manager can play immediately without having
    // to visit the tactics screen.
    const squad = allPlayers.filter((p) => p.clubId === clubId);
    const enginePlayers = squad.map((p) => toEnginePlayer(p));
    const formation = chooseFormation(enginePlayers);
    const { lineup, benchIds } = selectLineup(enginePlayers, formation);

    await tx.insert(careerTactics).values({
      careerId: career.id,
      formation,
      lineup,
      bench: benchIds,
    });

    await tx.insert(careerTraining).values({ careerId: career.id });

    // Budgets for every club, not only the manager's, because the AI clubs bid
    // against each other and have to be able to run out of money.
    await tx.insert(careerClubFinance).values(
      PL_CLUB_IDS.map((id) => {
        const rows = allPlayers.filter((p) => p.clubId === id);
        return {
          careerId: career.id,
          clubId: id,
          ...startingBudget(
            rows.map((p) => toEnginePlayer(p)),
            rows.reduce((sum, p) => sum + weeklyWage(p), 0),
          ),
        };
      }),
    );

    return career;
  });
}

/**
 * What a club starts the season with.
 *
 * Sized off squad strength rather than given flat, so the gap between the top
 * and the bottom of the division survives into the transfer market. The curve
 * is steep on purpose: in real terms the richest clubs have an order of
 * magnitude more to spend than the poorest, not twice as much.
 */
export function startingBudget(
  squad: EnginePlayer[],
  wageSpend: number,
): { transferBudget: number; wageBudget: number; wageSpend: number } {
  const strength = squadStrength(squad);

  // Calibrated so a title contender (squad strength around 84) starts with
  // something near 125 million and a promoted side (around 70) with the floor.
  // The exponent is what creates the gap: real budgets across a division differ
  // by an order of magnitude, not by a factor of two.
  const scale = Math.pow(Math.max(1, strength - 58) / 16, 3.1);
  const transferBudget = Math.round(Math.max(8_000_000, scale * 28_000_000) / 500_000) * 500_000;

  // Enough headroom to sign one or two, not enough to rebuild the wage bill.
  return { transferBudget, wageBudget: Math.round(wageSpend * 1.18), wageSpend };
}

/**
 * A player's weekly wage. The import carries one for most players; the fallback
 * derives it from overall on the same sort of curve as value, since the two
 * track each other closely.
 */
export function weeklyWage(row: PlayerRow): number {
  if (row.wageEur && row.wageEur > 0) return row.wageEur;
  return Math.round(Math.pow(Math.max(45, row.overall) / 10, 3.4) * 55);
}

/**
 * Fills in rows a career should have but does not.
 *
 * Careers created before budgets and training plans existed have neither, and
 * would otherwise load the transfer screen with nothing to spend. Rather than
 * demand a manual backfill for a game people already have saves in, the rows
 * are created on demand the first time something needs them. Cheap, because
 * `onConflictDoNothing` makes the repeat case a single no-op insert.
 */
export async function ensureCareerExtras(careerId: string): Promise<void> {
  const [existing] = await db
    .select({ clubId: careerClubFinance.clubId })
    .from(careerClubFinance)
    .where(eq(careerClubFinance.careerId, careerId))
    .limit(1);

  if (existing) return;

  const allPlayers = await db.select().from(players);
  const states = await db
    .select({
      playerId: careerPlayerState.playerId,
      clubId: careerPlayerState.clubId,
    })
    .from(careerPlayerState)
    .where(eq(careerPlayerState.careerId, careerId));

  const movedTo = new Map(states.map((s) => [s.playerId, s.clubId]));

  await db.transaction(async (tx) => {
    await tx.insert(careerTraining).values({ careerId }).onConflictDoNothing();

    await tx
      .insert(careerClubFinance)
      .values(
        PL_CLUB_IDS.map((id) => {
          const rows = allPlayers.filter((p) => (movedTo.get(p.id) ?? p.clubId) === id);
          return {
            careerId,
            clubId: id,
            ...startingBudget(
              rows.map((p) => toEnginePlayer(p)),
              rows.reduce((sum, p) => sum + weeklyWage(p), 0),
            ),
          };
        }),
      )
      .onConflictDoNothing();
  });
}

/** Creates a career, or returns the existing one for a username. */
export async function createOrResumeCareer(
  username: string,
  clubId?: number,
): Promise<{ career: CareerRow; resumed: boolean }> {
  const existing = await findCareerByUsername(username);
  if (existing) return { career: existing, resumed: true };

  if (clubId === undefined) {
    throw new Error("Pick a club to start a new career");
  }

  const career = await createCareer(username, clubId);
  return { career, resumed: false };
}

export type SquadMember = {
  player: PlayerRow;
  state: {
    /** Null while the player is still at the club the import put him at. */
    clubId: number | null;
    attributeDeltas: unknown;
    trainingFocus: string | null;
    fitness: number;
    form: number;
    injuredUntilRound: number | null;
    suspendedUntilRound: number | null;
    seasonYellows: number;
    apps: number;
    goals: number;
    assists: number;
    minutes: number;
    yellows: number;
    reds: number;
    ratingSum: number;
    ratingCount: number;
  };
};

/**
 * Who a player turns out for in this career.
 *
 * A transfer writes `career_player_state.club_id` and leaves the shared
 * `players.club_id` alone, so every squad query has to read through this
 * expression rather than the reference column. Using it anywhere a squad is
 * assembled is what keeps one manager's transfer business out of everybody
 * else's save.
 */
const effectiveClubId = sql<number>`COALESCE(${careerPlayerState.clubId}, ${players.clubId})`;

/** A club's squad in a career, with each player's current condition. */
export async function loadSquad(careerId: string, clubId: number): Promise<SquadMember[]> {
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
    .where(eq(effectiveClubId, clubId))
    .orderBy(asc(players.isGk), asc(players.shortName));

  return rows.map((r) => ({ player: r.player, state: r.state }));
}

/** Squads for several clubs at once, keyed by club id. */
export async function loadSquads(
  careerId: string,
  clubIds: number[],
): Promise<Map<number, SquadMember[]>> {
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
    .where(inArray(effectiveClubId, clubIds));

  const byClub = new Map<number, SquadMember[]>();
  for (const clubId of clubIds) byClub.set(clubId, []);
  for (const row of rows) {
    // Grouped by the career's club, not the imported one, or a signed player
    // would keep turning out for the club that sold him.
    const club = row.state.clubId ?? row.player.clubId;
    byClub.get(club)?.push({ player: row.player, state: row.state });
  }
  return byClub;
}

export async function loadAllClubs(): Promise<ClubRow[]> {
  return db.select().from(clubs).orderBy(asc(clubs.name));
}

/** The manager's saved shape and team sheet. */
export async function loadTactics(careerId: string) {
  const rows = await db
    .select()
    .from(careerTactics)
    .where(eq(careerTactics.careerId, careerId))
    .limit(1);
  return rows[0] ?? null;
}

export async function saveTactics(
  careerId: string,
  input: {
    formation: string;
    mentality: number;
    pressing: number;
    tempo: number;
    width: number;
    directness: number;
    lineup: { playerId: number; slot: Slot }[];
    bench: number[];
  },
): Promise<void> {
  await db
    .update(careerTactics)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(careerTactics.careerId, careerId));
}

/**
 * Checks a proposed team sheet against the manager's own squad and the
 * availability of each player. Returns the problems rather than throwing, so
 * the tactics screen can show all of them at once.
 */
export async function validateLineup(
  careerId: string,
  clubId: number,
  round: number,
  lineup: { playerId: number; slot: Slot }[],
  bench: number[],
): Promise<string[]> {
  const squad = await loadSquad(careerId, clubId);
  const byId = new Map(squad.map((m) => [m.player.id, m]));
  const problems: string[] = [];

  for (const entry of [...lineup.map((e) => e.playerId), ...bench]) {
    const member = byId.get(entry);
    if (!member) {
      problems.push("That player is not in your squad");
      continue;
    }
    const { state, player } = member;
    if (state.injuredUntilRound !== null && state.injuredUntilRound >= round) {
      problems.push(`${player.shortName} is injured`);
    }
    if (state.suspendedUntilRound !== null && state.suspendedUntilRound >= round) {
      problems.push(`${player.shortName} is suspended`);
    }
  }

  const keeper = lineup.find((e) => e.slot === "GK");
  if (keeper && !byId.get(keeper.playerId)?.player.isGk) {
    problems.push("Your goalkeeper slot needs an actual goalkeeper");
  }

  return [...new Set(problems)];
}
