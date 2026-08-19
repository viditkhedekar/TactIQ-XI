/**
 * Resolving a single moment: who is involved, and what happens.
 *
 * The match loop decides *when* something happens; this file decides *what*.
 * Keeping the two apart means the loop stays readable and every probability
 * question has one home. Nothing here mutates match state: these functions
 * pick players and roll outcomes, and the caller records the consequences.
 */

import { CHANCE_TYPES, DISCIPLINE, SHOOTING } from "./constants";
import { chance, weightedIndex, type RngState } from "./rng";
import { chanceTypeWeights } from "./tactics";
import { effectiveness, finishingScore, playerPace, type TeamRatings } from "./ratings";
import { performanceVariance } from "./fatigue";
import type { ChanceType, LineupPlayer, MatchSide, Slot, TeamTactics } from "./types";

/** How likely each slot is to be the one taking the chance, by chance type. */
const SHOOTER_WEIGHTS: Record<ChanceType, Partial<Record<Slot, number>>> = {
  through_ball: { ST: 3.5, LST: 3, RST: 3, LW: 1.6, RW: 1.6, CAM: 1.4, LCM: 0.4, RCM: 0.4, CM: 0.4 },
  cross: { ST: 3.2, LST: 2.8, RST: 2.8, CAM: 1.2, LW: 1.0, RW: 1.0, LCB: 0.3, RCB: 0.3, CB: 0.3 },
  cut_inside: { LW: 3, RW: 3, LM: 1.8, RM: 1.8, CAM: 1.8, ST: 1.2, LST: 1.0, RST: 1.0 },
  long_shot: {
    LCM: 2.2, RCM: 2.2, CM: 2.2, CAM: 2.4, CDM: 1.4, ST: 1.5, LST: 1.2, RST: 1.2,
    LW: 1.0, RW: 1.0, LM: 0.9, RM: 0.9, LB: 0.3, RB: 0.3,
  },
  counter: { ST: 3.2, LST: 2.6, RST: 2.6, LW: 2.2, RW: 2.2, CAM: 1.2, LM: 0.8, RM: 0.8 },
  set_piece: {
    LCB: 2.2, RCB: 2.2, CB: 2.2, ST: 2.4, LST: 2.0, RST: 2.0, CDM: 1.0,
    LCM: 0.8, RCM: 0.8, CM: 0.8, CAM: 0.8, LW: 0.5, RW: 0.5,
  },
  penalty: {},
};

/** How likely each slot is to provide the final pass. */
const ASSIST_WEIGHTS: Record<ChanceType, Partial<Record<Slot, number>>> = {
  through_ball: { CAM: 3, LCM: 2.2, RCM: 2.2, CM: 2.2, CDM: 0.8, LW: 1.4, RW: 1.4, ST: 0.8 },
  cross: { LW: 2.6, RW: 2.6, LM: 2.4, RM: 2.4, LWB: 2.0, RWB: 2.0, LB: 1.6, RB: 1.6, CAM: 0.6 },
  cut_inside: { CAM: 1.6, LCM: 1.2, RCM: 1.2, CM: 1.2, ST: 1.4, LW: 0.8, RW: 0.8 },
  long_shot: { CAM: 1.0, CM: 0.8, LCM: 0.8, RCM: 0.8 },
  counter: { ST: 1.8, LW: 1.6, RW: 1.6, CAM: 1.6, LCM: 1.0, RCM: 1.0, CM: 1.0 },
  set_piece: { CAM: 2.4, LCM: 1.6, RCM: 1.6, CM: 1.6, LW: 1.4, RW: 1.4, LM: 1.2, RM: 1.2 },
  penalty: {},
};

/** Which attribute set decides whether the chance is taken. */
export function finishingKind(type: ChanceType): "header" | "shot" | "long" | "penalty" {
  if (type === "penalty") return "penalty";
  if (type === "long_shot") return "long";
  if (type === "cross" || type === "set_piece") return "header";
  return "shot";
}

/** Attribute most associated with taking each kind of chance well. */
function shooterQuality(lp: LineupPlayer, type: ChanceType): number {
  const kind = finishingKind(type);
  const base = finishingScore(lp.player, kind);
  if (type === "through_ball" || type === "counter") {
    // Getting there first matters as much as the finish.
    return base * 0.75 + playerPace(lp.player) * 0.25;
  }
  return base;
}

function availableOutfield(side: MatchSide): LineupPlayer[] {
  return side.onPitch.filter((lp) => !lp.sentOff && !lp.player.isGk);
}

/**
 * Picks who takes the chance. Slot decides who tends to be in the position,
 * and quality decides who is trusted with it, so a strong finisher in the
 * right slot takes most of a side's chances without taking all of them.
 */
export function pickShooter(rng: RngState, side: MatchSide, type: ChanceType): LineupPlayer | null {
  const candidates = availableOutfield(side);
  if (candidates.length === 0) return null;

  const slotWeights = SHOOTER_WEIGHTS[type];
  const weights = candidates.map((lp) => {
    const slotWeight = slotWeights[lp.slot] ?? 0.15;
    const quality = Math.max(20, shooterQuality(lp, type));
    return slotWeight * (quality / 70) * effectiveness(lp);
  });

  return candidates[weightedIndex(rng, weights)];
}

/** Picks the provider, if there is one. Not every chance has an assist. */
export function pickAssister(
  rng: RngState,
  side: MatchSide,
  shooter: LineupPlayer,
  type: ChanceType,
): LineupPlayer | null {
  if (type === "penalty") return null;
  // Long shots and solo runs frequently have no meaningful assist.
  const assistChance = type === "long_shot" ? 0.3 : type === "cut_inside" ? 0.55 : 0.82;
  if (!chance(rng, assistChance)) return null;

  const candidates = availableOutfield(side).filter((lp) => lp.player.id !== shooter.player.id);
  if (candidates.length === 0) return null;

  const slotWeights = ASSIST_WEIGHTS[type];
  const weights = candidates.map((lp) => {
    const slotWeight = slotWeights[lp.slot] ?? 0.2;
    const creativity =
      type === "cross"
        ? lp.player.crossing
        : lp.player.vision * 0.6 + lp.player.shortPassing * 0.4;
    return slotWeight * (Math.max(20, creativity) / 70) * effectiveness(lp);
  });

  return candidates[weightedIndex(rng, weights)];
}

/**
 * Picks the player who commits a foul. Defenders and aggressive players do
 * most of the fouling, which is also why they collect most of the cards.
 */
export function pickFouler(rng: RngState, side: MatchSide): LineupPlayer | null {
  const candidates = availableOutfield(side);
  if (candidates.length === 0) return null;

  const defensiveBias: Partial<Record<Slot, number>> = {
    LCB: 1.5, CB: 1.5, RCB: 1.5, LB: 1.4, RB: 1.4, LWB: 1.3, RWB: 1.3,
    CDM: 1.7, LCM: 1.3, RCM: 1.3, CM: 1.3, LM: 1.0, RM: 1.0, CAM: 0.7,
    LW: 0.6, RW: 0.6, ST: 0.6, LST: 0.6, RST: 0.6,
  };

  const weights = candidates.map((lp) => {
    const slotWeight = defensiveBias[lp.slot] ?? 1.0;
    const aggression =
      1 + (lp.player.aggression - DISCIPLINE.aggressionPivot) / DISCIPLINE.aggressionScale;
    return slotWeight * Math.max(0.4, aggression);
  });

  return candidates[weightedIndex(rng, weights)];
}

/** Picks who was fouled: usually whoever was carrying the ball forward. */
export function pickFouled(rng: RngState, side: MatchSide): LineupPlayer | null {
  const candidates = availableOutfield(side);
  if (candidates.length === 0) return null;

  const attackingBias: Partial<Record<Slot, number>> = {
    ST: 2.0, LST: 1.8, RST: 1.8, LW: 1.8, RW: 1.8, CAM: 1.8, LM: 1.3, RM: 1.3,
    LCM: 1.1, RCM: 1.1, CM: 1.1, CDM: 0.7, LWB: 0.8, RWB: 0.8, LB: 0.6, RB: 0.6,
    LCB: 0.4, CB: 0.4, RCB: 0.4,
  };

  const weights = candidates.map((lp) => attackingBias[lp.slot] ?? 1.0);
  return candidates[weightedIndex(rng, weights)];
}

/** The most reliable penalty taker on the pitch. */
export function pickPenaltyTaker(side: MatchSide): LineupPlayer | null {
  const candidates = availableOutfield(side);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, lp) =>
    finishingScore(lp.player, "penalty") > finishingScore(best.player, "penalty") ? lp : best,
  );
}

/** Picks the kind of chance a moment turns into. */
export function pickChanceType(
  rng: RngState,
  tactics: TeamTactics,
  ratings: TeamRatings,
  opponent: TeamRatings,
): ChanceType {
  const weights = chanceTypeWeights(tactics, ratings, opponent);
  const keys = Object.keys(weights) as Exclude<ChanceType, "penalty">[];
  return keys[weightedIndex(rng, keys.map((k) => weights[k]))];
}

export type ShotOutcome = "goal" | "save" | "off" | "blocked";

/**
 * Resolves a shot in two steps, the way a chance actually plays out: first
 * whether it is on target at all, then whether the keeper can keep it out.
 * Splitting it this way is what keeps shots-on-target realistic instead of
 * every shot being a coin flip against the goalkeeper.
 */
export function resolveShot(
  rng: RngState,
  shooter: LineupPlayer,
  type: ChanceType,
  defence: number,
  goalkeeping: number,
): { outcome: ShotOutcome; xg: number } {
  const profile = CHANCE_TYPES[type];
  const quality = shooterQuality(shooter, type) * effectiveness(shooter) *
    performanceVariance(rng, shooter.player.composure);

  const pressure = type === "penalty" ? 0 : defence;
  const onTarget = Math.max(
    SHOOTING.onTargetMin,
    Math.min(
      SHOOTING.onTargetMax,
      profile.onTargetBase + (quality - pressure) / SHOOTING.onTargetScale,
    ),
  );

  // xG is reported for the stats panel and reflects the chance, not the result.
  const xg = Math.max(0.01, Math.min(0.95, profile.baseXg * (0.6 + quality / 175)));

  if (!chance(rng, onTarget)) {
    if (type !== "penalty" && chance(rng, SHOOTING.blockShare)) {
      return { outcome: "blocked", xg };
    }
    return { outcome: "off", xg };
  }

  const keeperFactor = (SHOOTING.gkPivot - goalkeeping) / SHOOTING.gkScale;
  const goalChance = Math.max(
    SHOOTING.goalMin,
    Math.min(SHOOTING.goalMax, (xg / onTarget) * keeperFactor),
  );

  return { outcome: chance(rng, goalChance) ? "goal" : "save", xg };
}

/** Whether a foul was cynical or dangerous enough to be a booking. */
export function resolveCard(rng: RngState): "none" | "yellow" | "red" {
  if (chance(rng, DISCIPLINE.redFromFoul)) return "red";
  if (chance(rng, DISCIPLINE.yellowFromFoul)) return "yellow";
  return "none";
}

/** Whether a foul was inside the box. */
export function isPenaltyFoul(rng: RngState, penaltyRate: number): boolean {
  return chance(rng, penaltyRate);
}
