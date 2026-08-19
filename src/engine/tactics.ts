/**
 * Formations and the tactical modifiers that make instructions matter.
 *
 * The point of a manager game is that these choices change what happens on the
 * pitch, not just what the screen says. Every function here feeds the match
 * loop directly: how many chances a side creates, what kind of chances they
 * are, how often they foul, and how fast their players tire.
 */

import { CHANCES, CHANCE_TYPE_WEIGHTS, DISCIPLINE, FATIGUE, POSSESSION } from "./constants";
import type { ChanceType, FormationName, Instruction, Slot, TeamTactics } from "./types";

/** The eleven slots each formation puts on the pitch. */
export const FORMATIONS: Record<FormationName, Slot[]> = {
  "4-4-2": ["GK", "LB", "LCB", "RCB", "RB", "LM", "LCM", "RCM", "RM", "LST", "RST"],
  "4-3-3": ["GK", "LB", "LCB", "RCB", "RB", "CDM", "LCM", "RCM", "LW", "ST", "RW"],
  "4-2-3-1": ["GK", "LB", "LCB", "RCB", "RB", "LCM", "RCM", "LW", "CAM", "RW", "ST"],
  "3-5-2": ["GK", "LCB", "CB", "RCB", "LWB", "RWB", "LCM", "CM", "RCM", "LST", "RST"],
  "5-4-1": ["GK", "LWB", "LCB", "CB", "RCB", "RWB", "LM", "LCM", "RCM", "RM", "ST"],
  "4-1-4-1": ["GK", "LB", "LCB", "RCB", "RB", "CDM", "LM", "LCM", "RCM", "RM", "ST"],
};

export const FORMATION_NAMES = Object.keys(FORMATIONS) as FormationName[];

export function isFormationName(value: string): value is FormationName {
  return value in FORMATIONS;
}

/** Indexes a 1..5 instruction into a five-element lookup table. */
export function fromInstruction<T>(table: readonly T[], value: Instruction): T {
  return table[Math.max(0, Math.min(4, value - 1))];
}

export const DEFAULT_TACTICS: TeamTactics = {
  formation: "4-3-3",
  mentality: 3,
  pressing: 3,
  tempo: 3,
  width: 3,
  directness: 3,
};

/**
 * Share of the ball, from the midfield battle plus tactical nudges.
 * A side playing fast and direct sees less of the ball by design; a side
 * pressing hard wins it back more often.
 */
export function possessionShare(
  homeMidfield: number,
  awayMidfield: number,
  home: TeamTactics,
  away: TeamTactics,
): number {
  const diff = (homeMidfield - awayMidfield) / POSSESSION.ratingScale;
  let share = 1 / (1 + Math.exp(-diff)) + POSSESSION.homeBonus;

  // Playing quickly and directly moves the ball on rather than keeping it.
  share -= (home.tempo - 3) * POSSESSION.tempoWeight;
  share += (away.tempo - 3) * POSSESSION.tempoWeight;
  share -= (home.directness - 3) * POSSESSION.tempoWeight * 0.8;
  share += (away.directness - 3) * POSSESSION.tempoWeight * 0.8;

  // Pressing hard wins the ball back.
  share += (home.pressing - 3) * POSSESSION.pressingWeight;
  share -= (away.pressing - 3) * POSSESSION.pressingWeight;

  return Math.max(POSSESSION.min, Math.min(POSSESSION.max, share));
}

/**
 * How many chance-creating moments a side generates per minute.
 * Attacking mentality buys more of them, and the opponent's mentality hands
 * over more in return: the classic risk trade.
 */
export function momentRate(
  attacking: { attackCentral: number; attackWide: number },
  defending: { defence: number },
  own: TeamTactics,
  opponent: TeamTactics,
  isHome: boolean,
  possession: number,
): number {
  const attack = Math.max(attacking.attackCentral, attacking.attackWide) * 0.6 +
    Math.min(attacking.attackCentral, attacking.attackWide) * 0.4;

  const edge = (attack - defending.defence) / CHANCES.attackDefenceScale;
  let rate = 1 + edge;

  rate *= fromInstruction(CHANCES.mentalityAttackMultiplier, own.mentality);
  rate *= fromInstruction(CHANCES.mentalityConcedeMultiplier, opponent.mentality);
  rate *= fromInstruction(CHANCES.tempoMomentMultiplier, own.tempo);

  // Having the ball more means more opportunities to do something with it,
  // but the relationship is deliberately soft: counter-attacking sides exist.
  rate *= 0.55 + possession * 0.9;

  if (isHome) rate *= 1 + CHANCES.homeMomentBonus;

  return Math.max(CHANCES.momentRateMin, Math.min(CHANCES.momentRateMax, rate));
}

/**
 * Relative weights for each kind of chance, shaped by instructions and by
 * where the side is actually strong. This is what makes a wide, crossing team
 * play visibly differently from a narrow, patient one.
 */
export function chanceTypeWeights(
  tactics: TeamTactics,
  ratings: { attackCentral: number; attackWide: number },
  opponent: { defLinePace: number },
): Record<Exclude<ChanceType, "penalty">, number> {
  const w = { ...CHANCE_TYPE_WEIGHTS } as Record<Exclude<ChanceType, "penalty">, number>;

  const widthBias = (tactics.width - 3) / 2;
  const directBias = (tactics.directness - 3) / 2;
  const mentalityBias = (tactics.mentality - 3) / 2;
  const tempoBias = (tactics.tempo - 3) / 2;

  // Width pushes play into crossing positions and away from central routes.
  w.cross *= 1 + widthBias * 0.55;
  w.cut_inside *= 1 - widthBias * 0.2;
  w.through_ball *= 1 - widthBias * 0.25;

  // Directness trades patient build-up for balls in behind and shots from range.
  w.through_ball *= 1 + directBias * 0.45;
  w.long_shot *= 1 + directBias * 0.2;
  w.cut_inside *= 1 - directBias * 0.25;

  // A high line is punished by pace in behind.
  const paceEdge = (70 - opponent.defLinePace) / 40;
  w.through_ball *= 1 + Math.max(-0.3, Math.min(0.5, paceEdge * 0.4));
  w.counter *= 1 + Math.max(-0.3, Math.min(0.5, paceEdge * 0.3));

  // Chasing the game means more shots from distance, fewer worked openings.
  w.long_shot *= 1 + mentalityBias * 0.3;
  w.through_ball *= 1 + mentalityBias * 0.15;

  // Playing quickly favours transitions.
  w.counter *= 1 + tempoBias * 0.35;

  // Lean on whichever flank of the attack is actually stronger.
  const balance = (ratings.attackWide - ratings.attackCentral) / 30;
  w.cross *= 1 + Math.max(-0.35, Math.min(0.35, balance));
  w.cut_inside *= 1 + Math.max(-0.25, Math.min(0.25, balance * 0.5));
  w.through_ball *= 1 - Math.max(-0.25, Math.min(0.25, balance * 0.5));

  for (const key of Object.keys(w) as (keyof typeof w)[]) {
    if (w[key] < 0.05) w[key] = 0.05;
  }
  return w;
}

/** Fouls conceded per minute, driven mostly by how hard the side presses. */
export function foulRate(tactics: TeamTactics, avgAggression: number): number {
  const pressing = fromInstruction(DISCIPLINE.pressingFoulMultiplier, tactics.pressing);
  const aggression =
    1 + (avgAggression - DISCIPLINE.aggressionPivot) / DISCIPLINE.aggressionScale;
  return DISCIPLINE.baseFoulRate * pressing * Math.max(0.7, aggression);
}

/** Probability per minute that pressing forces a turnover into a counter. */
export function turnoverChance(tactics: TeamTactics): number {
  return fromInstruction(CHANCES.pressTurnoverChance, tactics.pressing);
}

/** Fitness lost per minute by a player in a given slot under these instructions. */
export function fatigueDrain(slot: Slot, stamina: number, tactics: TeamTactics): number {
  const slotFactor = FATIGUE.slotDrain[slot] ?? 1.0;
  const staminaFactor = FATIGUE.staminaPivot - Math.max(0, Math.min(100, stamina)) / 100;
  const tempo = fromInstruction(FATIGUE.tempoDrainMultiplier, tactics.tempo);
  const pressing = fromInstruction(FATIGUE.pressingDrainMultiplier, tactics.pressing);
  return FATIGUE.baseDrainPerMinute * slotFactor * staminaFactor * tempo * pressing;
}

/**
 * Clamps a partial tactics update onto an existing one. Used when applying
 * a mid-match change, so a malformed payload cannot push a slider off-scale.
 */
export function applyTacticsChange(
  current: TeamTactics,
  change: Partial<TeamTactics>,
): TeamTactics {
  const clamp = (v: number | undefined, fallback: Instruction): Instruction =>
    v === undefined ? fallback : (Math.max(1, Math.min(5, Math.round(v))) as Instruction);

  return {
    formation:
      change.formation && isFormationName(change.formation) ? change.formation : current.formation,
    mentality: clamp(change.mentality, current.mentality),
    pressing: clamp(change.pressing, current.pressing),
    tempo: clamp(change.tempo, current.tempo),
    width: clamp(change.width, current.width),
    directness: clamp(change.directness, current.directness),
  };
}
