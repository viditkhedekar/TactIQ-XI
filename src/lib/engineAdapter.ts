/**
 * Translating between database rows and the engine's own types.
 *
 * The engine knows nothing about Drizzle, and the schema knows nothing about
 * the simulation. This is the only place the two meet, which keeps the engine
 * portable and means a schema change touches one file rather than twenty.
 */

import type { CareerPlayerStateRow, PlayerRow } from "@/db/schema";
import type { EnginePlayer, Position, Slot, TeamTactics } from "@/engine";
import type { CareerTacticsRow } from "@/db/schema";

/**
 * Combines a player's fixed attributes with their condition in this career.
 * A player with no state row yet is treated as fully fit and in neutral form.
 */
export function toEnginePlayer(
  row: PlayerRow,
  state?: Pick<CareerPlayerStateRow, "fitness" | "form"> | null,
): EnginePlayer {
  return {
    id: row.id,
    name: row.shortName,
    clubId: row.clubId,
    positions: row.positions as Position[],
    isGk: row.isGk,
    overall: row.overall,
    age: row.age,

    crossing: row.crossing,
    finishing: row.finishing,
    headingAccuracy: row.headingAccuracy,
    shortPassing: row.shortPassing,
    volleys: row.volleys,
    dribbling: row.dribbling,
    curve: row.curve,
    fkAccuracy: row.fkAccuracy,
    longPassing: row.longPassing,
    ballControl: row.ballControl,

    acceleration: row.acceleration,
    sprintSpeed: row.sprintSpeed,
    agility: row.agility,
    reactions: row.reactions,
    balance: row.balance,
    jumping: row.jumping,
    stamina: row.stamina,
    strength: row.strength,

    shotPower: row.shotPower,
    longShots: row.longShots,
    aggression: row.aggression,
    interceptions: row.interceptions,
    positioning: row.positioning,
    vision: row.vision,
    penalties: row.penalties,
    composure: row.composure,

    marking: row.marking,
    standingTackle: row.standingTackle,
    slidingTackle: row.slidingTackle,

    gkDiving: row.gkDiving,
    gkHandling: row.gkHandling,
    gkKicking: row.gkKicking,
    gkPositioning: row.gkPositioning,
    gkReflexes: row.gkReflexes,
    gkSpeed: row.gkSpeed,

    fitness: state?.fitness ?? 100,
    form: state?.form ?? 6.5,
  };
}

export type LineupEntry = { playerId: number; slot: Slot };

/** The instruction half of a saved tactics row. */
export function toTeamTactics(row: CareerTacticsRow): TeamTactics {
  return {
    formation: row.formation as TeamTactics["formation"],
    mentality: row.mentality as TeamTactics["mentality"],
    pressing: row.pressing as TeamTactics["pressing"],
    tempo: row.tempo as TeamTactics["tempo"],
    width: row.width as TeamTactics["width"],
    directness: row.directness as TeamTactics["directness"],
  };
}

/** The stored lineup, which is jsonb and therefore untyped on the way out. */
export function toLineup(row: CareerTacticsRow): LineupEntry[] {
  const raw = row.lineup;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is LineupEntry =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as LineupEntry).playerId === "number" &&
      typeof (entry as LineupEntry).slot === "string",
  );
}

export function toBench(row: CareerTacticsRow): number[] {
  const raw = row.bench;
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is number => typeof id === "number");
}

/**
 * These take only the fields they read rather than a whole state row, so
 * callers holding a projection do not have to invent the columns they lack.
 */
type Availability = Pick<CareerPlayerStateRow, "injuredUntilRound" | "suspendedUntilRound">;
type RatingTotals = Pick<CareerPlayerStateRow, "ratingSum" | "ratingCount">;

/** Whether a player can be picked for a given round. */
export function isAvailable(state: Availability, round: number): boolean {
  return unavailableReason(state, round) === null;
}

/** Why a player cannot be picked, for display next to their name. */
export function unavailableReason(
  state: Availability,
  round: number,
): "injured" | "suspended" | null {
  if (state.injuredUntilRound !== null && state.injuredUntilRound >= round) return "injured";
  if (state.suspendedUntilRound !== null && state.suspendedUntilRound >= round) return "suspended";
  return null;
}

/** Average match rating, or null for a player who has not featured. */
export function averageRating(state: RatingTotals): number | null {
  if (state.ratingCount === 0) return null;
  return Math.round((state.ratingSum / state.ratingCount) * 10) / 10;
}
