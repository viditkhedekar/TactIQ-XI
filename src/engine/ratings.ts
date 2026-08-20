/**
 * Turns individual attributes into the handful of team ratings the match loop
 * actually consumes.
 *
 * The source data gives ~40 attributes per player. Rather than consult them
 * one at a time mid-simulation, each side is condensed at kickoff (and again
 * whenever the lineup or instructions change) into six numbers: midfield
 * control, central attack, wide attack, defence, defensive-line pace and
 * goalkeeping. Every contribution is scaled by how well the player suits the
 * slot, how fresh they are, and what sort of run they are on.
 */

import { CAPTAIN, FATIGUE, FORM, HOME_ADVANTAGE } from "./constants";
import type { EnginePlayer, LineupPlayer, MatchSide, Position, Slot } from "./types";

/** Which natural positions play each slot without penalty. */
const SLOT_NATURAL: Record<Slot, Position[]> = {
  GK: ["GK"],
  LB: ["LB", "LWB"],
  LCB: ["CB"],
  CB: ["CB"],
  RCB: ["CB"],
  RB: ["RB", "RWB"],
  LWB: ["LWB", "LB"],
  RWB: ["RWB", "RB"],
  CDM: ["CDM"],
  LCM: ["CM"],
  CM: ["CM"],
  RCM: ["CM"],
  CAM: ["CAM"],
  LM: ["LM"],
  RM: ["RM"],
  LW: ["LW"],
  RW: ["RW"],
  ST: ["ST", "CF"],
  LST: ["ST", "CF"],
  RST: ["ST", "CF"],
};

/** Positions that can cover a slot at a cost. Anything absent is a bad fit. */
const SLOT_ADJACENT: Record<Slot, Partial<Record<Position, number>>> = {
  GK: {},
  LB: { CB: 0.82, LM: 0.84, LW: 0.76, RB: 0.72, RWB: 0.68 },
  LCB: { LB: 0.82, CDM: 0.84, RB: 0.78 },
  CB: { LB: 0.8, RB: 0.8, CDM: 0.84 },
  RCB: { RB: 0.82, CDM: 0.84, LB: 0.78 },
  RB: { CB: 0.82, RM: 0.84, RW: 0.76, LB: 0.72, LWB: 0.68 },
  LWB: { LM: 0.88, LW: 0.82, CB: 0.72, RWB: 0.7, RB: 0.7 },
  RWB: { RM: 0.88, RW: 0.82, CB: 0.72, LWB: 0.7, LB: 0.7 },
  CDM: { CM: 0.92, CB: 0.85 },
  LCM: { CDM: 0.92, CAM: 0.92, LM: 0.86 },
  CM: { CDM: 0.92, CAM: 0.92, LM: 0.86, RM: 0.86 },
  RCM: { CDM: 0.92, CAM: 0.92, RM: 0.86 },
  CAM: { CM: 0.92, CF: 0.88, LW: 0.84, RW: 0.84, ST: 0.8 },
  LM: { LW: 0.92, CM: 0.86, LWB: 0.86, LB: 0.8, RM: 0.74 },
  RM: { RW: 0.92, CM: 0.86, RWB: 0.86, RB: 0.8, LM: 0.74 },
  LW: { LM: 0.92, CAM: 0.85, ST: 0.82, CF: 0.85, RW: 0.78 },
  RW: { RM: 0.92, CAM: 0.85, ST: 0.82, CF: 0.85, LW: 0.78 },
  ST: { CF: 0.96, CAM: 0.84, LW: 0.86, RW: 0.86 },
  LST: { CF: 0.96, CAM: 0.84, LW: 0.86, RW: 0.86 },
  RST: { CF: 0.96, CAM: 0.84, LW: 0.86, RW: 0.86 },
};

/** An outfielder forced into goal, or a keeper stranded outfield. */
const WRONG_ROLE_FIT = 0.3;
/** Any pairing not covered above: technically playable, clearly uncomfortable. */
const POOR_FIT = 0.7;

/**
 * How well a player suits a slot, from 1.0 (natural) down to 0.3 (a keeper
 * playing up front). Multiplies every contribution that player makes.
 */
export function positionFit(player: EnginePlayer, slot: Slot): number {
  const isGkSlot = slot === "GK";
  if (isGkSlot !== player.isGk) return WRONG_ROLE_FIT;
  if (isGkSlot) return 1.0;

  const natural = SLOT_NATURAL[slot];
  if (player.positions.some((p) => natural.includes(p))) return 1.0;

  const adjacent = SLOT_ADJACENT[slot];
  let best = 0;
  for (const p of player.positions) {
    const fit = adjacent[p];
    if (fit !== undefined && fit > best) best = fit;
  }
  return best > 0 ? best : POOR_FIT;
}

/**
 * Tiredness multiplier. Full fitness is neutral; a spent player drops toward
 * the floor, which is what makes substitutions and rotation worth doing.
 */
export function fitnessMultiplier(fitness: number): number {
  const f = Math.max(0, Math.min(100, fitness));
  if (f >= 90) return 1.0;
  // Linear from 1.0 at 90 down to the floor at 0.
  const span = 1.0 - FATIGUE.effectivenessFloor;
  return FATIGUE.effectivenessFloor + (f / 90) * span;
}

/** Confidence multiplier from recent match ratings. */
export function formMultiplier(form: number): number {
  const clamped = Math.max(FORM.minForm, Math.min(FORM.maxForm, form));
  const t = (clamped - FORM.minForm) / (FORM.maxForm - FORM.minForm);
  return FORM.minMultiplier + t * (FORM.maxMultiplier - FORM.minMultiplier);
}

/** Combined effectiveness of a player in their current slot and condition. */
export function effectiveness(lp: LineupPlayer): number {
  if (lp.sentOff) return 0;
  return (
    positionFit(lp.player, lp.slot) * fitnessMultiplier(lp.fitness) * formMultiplier(lp.player.form)
  );
}

/**
 * What the armband is worth to the rest of the side.
 *
 * Deliberately small. A captain who swung matches would be a hidden fudge that
 * made the team sheet lie about where results come from, and one who did
 * nothing would make the armband a decoration. This is a nudge, largest when a
 * composed captain is on the pitch and the side is behind and needs settling,
 * and it is worth nothing at all once he has been substituted or sent off.
 */
export function captainBonus(side: MatchSide, goalDifference: number): number {
  const captainId = side.tactics.captainId;
  if (captainId === null) return 1;

  const captain = side.onPitch.find((lp) => lp.player.id === captainId && !lp.sentOff);
  if (!captain) return 1;

  const above = captain.player.composure - CAPTAIN.composurePivot;
  if (above <= 0) return 1;

  // Composure of 100 against a pivot of 70 is a full-strength captain.
  const strength = Math.min(1, above / 30);
  const situational = goalDifference < 0 ? CAPTAIN.behindMultiplier : 1;

  return 1 + strength * CAPTAIN.maxTeamBonus * situational;
}

type Weighted = { attr: keyof EnginePlayer; weight: number };

function weightedScore(p: EnginePlayer, parts: Weighted[]): number {
  let total = 0;
  for (const { attr, weight } of parts) total += (p[attr] as number) * weight;
  return total;
}

/** Which slots contribute to each unit, and how strongly. */
const MIDFIELD_SHARE: Partial<Record<Slot, number>> = {
  CDM: 1.0,
  LCM: 1.0,
  CM: 1.0,
  RCM: 1.0,
  CAM: 0.85,
  LM: 0.55,
  RM: 0.55,
  LWB: 0.4,
  RWB: 0.4,
  LW: 0.3,
  RW: 0.3,
  ST: 0.15,
  LST: 0.15,
  RST: 0.15,
  LB: 0.25,
  RB: 0.25,
  LCB: 0.15,
  CB: 0.15,
  RCB: 0.15,
};

const ATTACK_CENTRAL_SHARE: Partial<Record<Slot, number>> = {
  ST: 1.0,
  LST: 1.0,
  RST: 1.0,
  CAM: 0.8,
  LW: 0.5,
  RW: 0.5,
  LCM: 0.3,
  CM: 0.3,
  RCM: 0.3,
  LM: 0.25,
  RM: 0.25,
  CDM: 0.1,
};

const ATTACK_WIDE_SHARE: Partial<Record<Slot, number>> = {
  LW: 1.0,
  RW: 1.0,
  LM: 0.9,
  RM: 0.9,
  LWB: 0.75,
  RWB: 0.75,
  LB: 0.5,
  RB: 0.5,
  CAM: 0.3,
  ST: 0.2,
  LST: 0.2,
  RST: 0.2,
};

const DEFENCE_SHARE: Partial<Record<Slot, number>> = {
  LCB: 1.0,
  CB: 1.0,
  RCB: 1.0,
  LB: 0.85,
  RB: 0.85,
  LWB: 0.7,
  RWB: 0.7,
  CDM: 0.8,
  LCM: 0.45,
  CM: 0.45,
  RCM: 0.45,
  LM: 0.3,
  RM: 0.3,
  CAM: 0.15,
  LW: 0.1,
  RW: 0.1,
  ST: 0.08,
  LST: 0.08,
  RST: 0.08,
};

const MIDFIELD_ATTRS: Weighted[] = [
  { attr: "shortPassing", weight: 0.3 },
  { attr: "ballControl", weight: 0.2 },
  { attr: "vision", weight: 0.2 },
  { attr: "longPassing", weight: 0.15 },
  { attr: "reactions", weight: 0.15 },
];

const ATTACK_CENTRAL_ATTRS: Weighted[] = [
  { attr: "finishing", weight: 0.3 },
  { attr: "positioning", weight: 0.25 },
  { attr: "dribbling", weight: 0.2 },
  { attr: "composure", weight: 0.15 },
  { attr: "shotPower", weight: 0.1 },
];

const ATTACK_WIDE_ATTRS: Weighted[] = [
  { attr: "crossing", weight: 0.3 },
  { attr: "dribbling", weight: 0.2 },
  { attr: "agility", weight: 0.2 },
  { attr: "acceleration", weight: 0.15 },
  { attr: "sprintSpeed", weight: 0.15 },
];

const DEFENCE_ATTRS: Weighted[] = [
  { attr: "marking", weight: 0.3 },
  { attr: "standingTackle", weight: 0.25 },
  { attr: "interceptions", weight: 0.2 },
  { attr: "headingAccuracy", weight: 0.15 },
  { attr: "strength", weight: 0.1 },
];

const GK_ATTRS: Weighted[] = [
  { attr: "gkReflexes", weight: 0.3 },
  { attr: "gkDiving", weight: 0.25 },
  { attr: "gkPositioning", weight: 0.25 },
  { attr: "gkHandling", weight: 0.2 },
];

/**
 * Weighted average over the players on the pitch, where each player's share
 * comes from their slot and their contribution is scaled by effectiveness.
 * Sent-off players simply stop contributing, which is how playing a man down
 * hurts without any special-casing elsewhere.
 */
function unitRating(
  onPitch: LineupPlayer[],
  shares: Partial<Record<Slot, number>>,
  attrs: Weighted[],
): number {
  let weighted = 0;
  let totalShare = 0;

  for (const lp of onPitch) {
    if (lp.sentOff || lp.player.isGk) continue;
    const share = shares[lp.slot];
    if (!share) continue;
    weighted += weightedScore(lp.player, attrs) * effectiveness(lp) * share;
    totalShare += share;
  }

  if (totalShare === 0) return 30;
  const raw = weighted / totalShare;

  // A short-handed side loses ground even where the missing player was not a
  // big contributor to this unit.
  const active = onPitch.filter((lp) => !lp.sentOff).length;
  const shorthanded = active >= 11 ? 1 : 1 - (11 - active) * 0.06;
  return raw * shorthanded;
}

export type TeamRatings = {
  midfield: number;
  attackCentral: number;
  attackWide: number;
  defence: number;
  defLinePace: number;
  goalkeeping: number;
};

/**
 * `goalDifference` is from this side's point of view, and is only used for the
 * captain, who steadies a side more when it is chasing a game than when it is
 * cruising.
 */
export function computeTeamRatings(side: MatchSide, goalDifference = 0): TeamRatings {
  const onPitch = side.onPitch;
  const gk = onPitch.find((lp) => lp.slot === "GK" && !lp.sentOff);

  const goalkeeping = gk
    ? weightedScore(gk.player, GK_ATTRS) * fitnessMultiplier(gk.fitness) * positionFit(gk.player, "GK")
    : // No keeper on the pitch (sent off with no replacement): outfielder in goal.
      35;

  // Pace of the back line, used to punish a high line against quick attackers.
  const defenders = onPitch.filter(
    (lp) => !lp.sentOff && (DEFENCE_SHARE[lp.slot] ?? 0) >= 0.7 && !lp.player.isGk,
  );
  const defLinePace =
    defenders.length > 0
      ? defenders.reduce((sum, lp) => sum + (lp.player.acceleration + lp.player.sprintSpeed) / 2, 0) /
        defenders.length
      : 50;

  const awayPenalty = side.isHome ? 1 : HOME_ADVANTAGE.awayCompositePenalty;
  // One multiplier applied to every unit, so the armband settles the whole side
  // rather than mysteriously improving only the defence.
  const armband = captainBonus(side, goalDifference);
  const scale = awayPenalty * armband;

  return {
    midfield: unitRating(onPitch, MIDFIELD_SHARE, MIDFIELD_ATTRS) * scale,
    attackCentral: unitRating(onPitch, ATTACK_CENTRAL_SHARE, ATTACK_CENTRAL_ATTRS) * scale,
    attackWide: unitRating(onPitch, ATTACK_WIDE_SHARE, ATTACK_WIDE_ATTRS) * scale,
    defence: unitRating(onPitch, DEFENCE_SHARE, DEFENCE_ATTRS) * scale,
    defLinePace,
    goalkeeping: goalkeeping * scale,
  };
}

/** Squad strength used for seeding, AI mentality and the pre-match odds. */
export function squadStrength(players: EnginePlayer[]): number {
  if (players.length === 0) return 50;
  const sorted = players.slice().sort((a, b) => b.overall - a.overall);
  const core = sorted.slice(0, 16);
  return core.reduce((sum, p) => sum + p.overall, 0) / core.length;
}

/** Pace of an attacker, used for through balls and one-on-ones. */
export function playerPace(p: EnginePlayer): number {
  return (p.acceleration + p.sprintSpeed) / 2;
}

/** How well a player finishes a given kind of chance. */
export function finishingScore(p: EnginePlayer, kind: "header" | "shot" | "long" | "penalty"): number {
  switch (kind) {
    case "header":
      return p.headingAccuracy * 0.6 + p.jumping * 0.2 + p.positioning * 0.2;
    case "long":
      return p.longShots * 0.55 + p.shotPower * 0.3 + p.composure * 0.15;
    case "penalty":
      return p.penalties * 0.7 + p.composure * 0.3;
    case "shot":
    default:
      return p.finishing * 0.55 + p.composure * 0.25 + p.positioning * 0.2;
  }
}
