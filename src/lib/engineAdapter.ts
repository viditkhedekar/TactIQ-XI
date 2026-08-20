/**
 * Translating between database rows and the engine's own types.
 *
 * The engine knows nothing about Drizzle, and the schema knows nothing about
 * the simulation. This is the only place the two meet, which keeps the engine
 * portable and means a schema change touches one file rather than twenty.
 */

import type { CareerPlayerStateRow, PlayerRow } from "@/db/schema";
import {
  SLOT_HOME,
  applyDeltas,
  normaliseTactics,
  type EnginePlayer,
  type PitchPlacement,
  type Position,
  type Slot,
  type TeamTactics,
  type TrainableAttribute,
} from "@/engine";
import type { CareerTacticsRow } from "@/db/schema";

/** The state fields that change how a player performs, all of them optional. */
type PlayerCondition = Partial<
  Pick<CareerPlayerStateRow, "fitness" | "form" | "clubId" | "attributeDeltas">
>;

/** Stored training movement, which is jsonb and therefore untyped on the way out. */
export function toAttributeDeltas(
  raw: unknown,
): Partial<Record<TrainableAttribute, number>> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;

  const out: Partial<Record<TrainableAttribute, number>> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      out[key as TrainableAttribute] = value;
    }
  }
  return out;
}

/**
 * Combines a player's fixed attributes with their condition in this career.
 * A player with no state row yet is treated as fully fit and in neutral form.
 *
 * Two career-scoped overrides are applied here rather than in the query: the
 * club he plays for, which a transfer changes, and the attribute movement he
 * has earned in training. Both live in career state so the imported player row
 * stays shared and read-only.
 */
export function toEnginePlayer(row: PlayerRow, state?: PlayerCondition | null): EnginePlayer {
  const base: EnginePlayer = {
    id: row.id,
    name: row.shortName,
    clubId: state?.clubId ?? row.clubId,
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

  return applyDeltas(base, toAttributeDeltas(state?.attributeDeltas));
}

export type LineupEntry = PitchPlacement;

/**
 * The instruction half of a saved tactics row.
 *
 * The newer instructions live in one jsonb column rather than as a dozen more
 * smallints, because they are read and written as a set and never queried
 * individually. `normaliseTactics` fills in whatever a given row predates, so a
 * plan saved before an instruction existed loads with it at neutral.
 */
export function toTeamTactics(row: CareerTacticsRow): TeamTactics {
  const stored = (row.instructions ?? {}) as Partial<TeamTactics>;

  return normaliseTactics({
    ...stored,
    formation: row.formation as TeamTactics["formation"],
    mentality: row.mentality as TeamTactics["mentality"],
    pressing: row.pressing as TeamTactics["pressing"],
    tempo: row.tempo as TeamTactics["tempo"],
    width: row.width as TeamTactics["width"],
    directness: row.directness as TeamTactics["directness"],
  });
}

/** The half of a plan that lives in the jsonb column. */
export function toStoredInstructions(tactics: TeamTactics) {
  return {
    defensiveLine: tactics.defensiveLine,
    closingDown: tactics.closingDown,
    tackling: tactics.tackling,
    offsideTrap: tactics.offsideTrap,
    finalThird: tactics.finalThird,
    passingFocus: tactics.passingFocus,
    keeperDistribution: tactics.keeperDistribution,
    setPieces: tactics.setPieces,
    captainId: tactics.captainId,
  };
}

/**
 * The stored lineup, which is jsonb and therefore untyped on the way out.
 *
 * Rows saved before the board became drag-and-drop carry no coordinates. Rather
 * than reject them, the slot's own resting place is filled in, so an old team
 * sheet opens as the shape it always was and can then be dragged about.
 */
export function toLineup(row: CareerTacticsRow): LineupEntry[] {
  const raw = row.lineup;
  if (!Array.isArray(raw)) return [];

  return raw
    .filter(
      (entry): entry is { playerId: number; slot: Slot; x?: unknown; y?: unknown } =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as { playerId?: unknown }).playerId === "number" &&
        typeof (entry as { slot?: unknown }).slot === "string",
    )
    .map((entry) => {
      const home = SLOT_HOME[entry.slot] ?? { x: 50, y: 50 };
      return {
        playerId: entry.playerId,
        slot: entry.slot,
        x: typeof entry.x === "number" && Number.isFinite(entry.x) ? entry.x : home.x,
        y: typeof entry.y === "number" && Number.isFinite(entry.y) ? entry.y : home.y,
      };
    });
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
