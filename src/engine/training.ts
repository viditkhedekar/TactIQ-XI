/**
 * Training between matches.
 *
 * A week of training nudges attributes. The nudges are deliberately small: a
 * focused attribute moves by roughly a tenth of a point a week at normal
 * intensity, so a full season of work on finishing is worth a few points to a
 * young forward and almost nothing to a thirty-two year old. That is the shape
 * real development has, and it is what stops training from turning every squad
 * into world beaters by March.
 *
 * Three things gate how much a player gains:
 *
 *   age        the young improve, the old hold on and then decline
 *   headroom   how far below their ceiling they currently sit
 *   intensity  what the manager asked for, paid for in fatigue and injuries
 *
 * Gains are fractional and accumulate. A player's stored deltas are added to
 * the reference attributes when the squad is loaded, which keeps the imported
 * player data read-only and per-career development separate from it.
 */

import { chance, randInt, type RngState } from "./rng";
import type { EnginePlayer, Position } from "./types";

/** Attributes training can move. The keys are a subset of EnginePlayer's. */
export type TrainableAttribute =
  | "crossing"
  | "finishing"
  | "headingAccuracy"
  | "shortPassing"
  | "volleys"
  | "dribbling"
  | "curve"
  | "fkAccuracy"
  | "longPassing"
  | "ballControl"
  | "acceleration"
  | "sprintSpeed"
  | "agility"
  | "reactions"
  | "balance"
  | "jumping"
  | "stamina"
  | "strength"
  | "shotPower"
  | "longShots"
  | "aggression"
  | "interceptions"
  | "positioning"
  | "vision"
  | "penalties"
  | "composure"
  | "marking"
  | "standingTackle"
  | "slidingTackle"
  | "gkDiving"
  | "gkHandling"
  | "gkKicking"
  | "gkPositioning"
  | "gkReflexes";

export type TrainingFocus =
  | "balanced"
  | "finishing"
  | "creativity"
  | "wing_play"
  | "defending"
  | "aerial"
  | "fitness"
  | "possession"
  | "pressing"
  | "set_pieces"
  | "discipline"
  | "goalkeeping";

/** 1 is a light week, 5 is flogging them. */
export type TrainingIntensity = 1 | 2 | 3 | 4 | 5;

export type TrainingPlan = {
  focus: TrainingFocus;
  intensity: TrainingIntensity;
  /** Per-player overrides, for putting one man on something specific. */
  individual?: Record<number, TrainingFocus>;
};

/**
 * What each focus works on, and how hard.
 *
 * The weights are relative within a focus, not absolute: a session spent on
 * finishing puts most of its effort into finishing itself and a little into the
 * things around it. Negative weights are how a focus trains something down,
 * which is the only sensible way to model calming a player's aggression.
 */
export const FOCUS_ATTRIBUTES: Record<TrainingFocus, Partial<Record<TrainableAttribute, number>>> = {
  balanced: {
    ballControl: 0.5,
    shortPassing: 0.5,
    reactions: 0.5,
    stamina: 0.5,
    composure: 0.4,
  },
  finishing: {
    finishing: 1.0,
    composure: 0.5,
    positioning: 0.6,
    shotPower: 0.5,
    volleys: 0.4,
    longShots: 0.3,
  },
  creativity: {
    vision: 1.0,
    shortPassing: 0.7,
    longPassing: 0.6,
    curve: 0.4,
    ballControl: 0.5,
  },
  wing_play: {
    crossing: 1.0,
    dribbling: 0.7,
    agility: 0.5,
    acceleration: 0.4,
    sprintSpeed: 0.4,
  },
  defending: {
    marking: 1.0,
    standingTackle: 0.8,
    slidingTackle: 0.6,
    interceptions: 0.7,
    reactions: 0.4,
  },
  aerial: {
    headingAccuracy: 1.0,
    jumping: 0.7,
    strength: 0.6,
    positioning: 0.3,
  },
  fitness: {
    stamina: 1.0,
    strength: 0.6,
    acceleration: 0.4,
    sprintSpeed: 0.4,
    balance: 0.3,
  },
  possession: {
    shortPassing: 1.0,
    ballControl: 0.8,
    composure: 0.5,
    vision: 0.4,
  },
  pressing: {
    stamina: 0.8,
    aggression: 0.6,
    interceptions: 0.8,
    reactions: 0.6,
    acceleration: 0.4,
  },
  set_pieces: {
    fkAccuracy: 1.0,
    curve: 0.7,
    penalties: 0.6,
    crossing: 0.4,
    headingAccuracy: 0.3,
  },
  discipline: {
    composure: 1.0,
    positioning: 0.5,
    marking: 0.4,
    // Calmer players dive into fewer tackles, and collect fewer cards for it.
    aggression: -0.8,
  },
  goalkeeping: {
    gkReflexes: 1.0,
    gkDiving: 0.8,
    gkHandling: 0.7,
    gkPositioning: 0.7,
    gkKicking: 0.4,
  },
};

export const TRAINING_FOCUS_LABELS: Record<TrainingFocus, string> = {
  balanced: "Balanced",
  finishing: "Finishing",
  creativity: "Creativity",
  wing_play: "Wing play",
  defending: "Defending",
  aerial: "Aerial work",
  fitness: "Fitness",
  possession: "Possession",
  pressing: "Pressing",
  set_pieces: "Set pieces",
  discipline: "Discipline",
  goalkeeping: "Goalkeeping",
};

export const TRAINING = {
  /** Attribute points a weight of 1.0 earns per week at intensity 3. */
  basePerWeek: 0.13,
  intensityGain: [0.45, 0.75, 1.0, 1.25, 1.45] as const,
  /** Fitness the week's work costs, on top of match fatigue. */
  intensityFitnessCost: [0, 1.5, 3, 5.5, 8.5] as const,
  /** Probability per player per week of a training-ground injury. */
  intensityInjuryRisk: [0, 0.0008, 0.002, 0.006, 0.013] as const,
  /** Rounds lost to a training injury. */
  injuryOutRounds: [1, 4] as const,
  /** Age bands and how readily a player still improves in each. */
  ageGrowth: [
    { maxAge: 21, factor: 1.0 },
    { maxAge: 24, factor: 0.8 },
    { maxAge: 27, factor: 0.5 },
    { maxAge: 30, factor: 0.25 },
    { maxAge: 99, factor: 0.08 },
  ],
  /** Past this age the physical attributes go the other way. */
  declineAge: 31,
  declinePerWeek: 0.055,
  declineAttributes: [
    "acceleration",
    "sprintSpeed",
    "agility",
    "stamina",
    "jumping",
    "balance",
  ] as const satisfies readonly TrainableAttribute[],
  /**
   * A player at their ceiling still improves a little, because a ceiling is a
   * soft thing and a squad that flatly stops developing feels dead.
   */
  minHeadroomFactor: 0.15,
  /** Headroom this many points below potential counts as full room to grow. */
  headroomSpan: 8,
  /** No attribute is trained past this, whatever the potential says. */
  attributeCeiling: 99,
  attributeFloor: 10,
};

function ageFactor(age: number): number {
  for (const band of TRAINING.ageGrowth) {
    if (age <= band.maxAge) return band.factor;
  }
  return 0.08;
}

/** How much room a player still has, from their overall against their ceiling. */
function headroomFactor(player: EnginePlayer, potential: number): number {
  const room = Math.max(0, potential - player.overall);
  const scaled = Math.min(1, room / TRAINING.headroomSpan);
  return Math.max(TRAINING.minHeadroomFactor, scaled);
}

/**
 * Keepers and outfielders do not benefit from the same sessions. Rather than
 * forbid combinations, a session a player has no use for simply does very
 * little, which lets a manager put a keeper on set pieces if they insist.
 */
function relevance(player: EnginePlayer, focus: TrainingFocus): number {
  if (focus === "goalkeeping") return player.isGk ? 1 : 0.05;
  if (player.isGk) return focus === "fitness" || focus === "discipline" ? 0.7 : 0.15;

  const positions = player.positions;
  const has = (...list: Position[]) => list.some((p) => positions.includes(p));

  switch (focus) {
    case "finishing":
      return has("ST", "CF", "CAM", "LW", "RW") ? 1 : 0.45;
    case "defending":
      return has("CB", "LB", "RB", "LWB", "RWB", "CDM") ? 1 : 0.45;
    case "wing_play":
      return has("LW", "RW", "LM", "RM", "LWB", "RWB", "LB", "RB") ? 1 : 0.45;
    case "creativity":
      return has("CAM", "CM", "CDM", "LW", "RW") ? 1 : 0.55;
    case "aerial":
      return has("CB", "ST", "CF", "CDM") ? 1 : 0.6;
    default:
      return 1;
  }
}

export type TrainingResult = {
  playerId: number;
  /** Fractional attribute movement for this week. */
  deltas: Partial<Record<TrainableAttribute, number>>;
  /** Fitness cost of the week's work. */
  fitnessCost: number;
  /** Set when the player broke down in training. */
  injury: { outRounds: number } | null;
};

/**
 * One week of training for one player.
 *
 * `potential` comes from the reference data rather than EnginePlayer, which
 * carries only what the match loop needs.
 */
export function trainPlayer(
  rng: RngState,
  player: EnginePlayer,
  potential: number,
  focus: TrainingFocus,
  intensity: TrainingIntensity,
): TrainingResult {
  const deltas: Partial<Record<TrainableAttribute, number>> = {};

  const gain =
    TRAINING.basePerWeek *
    TRAINING.intensityGain[intensity - 1] *
    ageFactor(player.age) *
    headroomFactor(player, potential) *
    relevance(player, focus);

  for (const [attr, weight] of Object.entries(FOCUS_ATTRIBUTES[focus])) {
    const key = attr as TrainableAttribute;
    // A negative weight trains something down and should not be scaled by
    // headroom, which is about how much better a player can get.
    const movement = weight < 0 ? TRAINING.basePerWeek * weight : gain * weight;
    deltas[key] = (deltas[key] ?? 0) + movement;
  }

  // Age catches everyone eventually, and it catches the legs first.
  if (player.age >= TRAINING.declineAge) {
    const severity = 1 + (player.age - TRAINING.declineAge) * 0.25;
    for (const attr of TRAINING.declineAttributes) {
      deltas[attr] = (deltas[attr] ?? 0) - TRAINING.declinePerWeek * severity;
    }
  }

  const injured = chance(rng, TRAINING.intensityInjuryRisk[intensity - 1]);

  return {
    playerId: player.id,
    deltas,
    fitnessCost: TRAINING.intensityFitnessCost[intensity - 1],
    injury: injured
      ? { outRounds: randInt(rng, TRAINING.injuryOutRounds[0], TRAINING.injuryOutRounds[1]) }
      : null,
  };
}

/** A week of training for a whole squad. */
export function trainSquad(
  rng: RngState,
  squad: { player: EnginePlayer; potential: number }[],
  plan: TrainingPlan,
): TrainingResult[] {
  return squad.map(({ player, potential }) =>
    trainPlayer(
      rng,
      player,
      potential,
      plan.individual?.[player.id] ?? plan.focus,
      plan.intensity,
    ),
  );
}

/**
 * Folds a week's movement into a player's running deltas, holding each
 * attribute inside its bounds. Kept separate from `trainPlayer` so the caller
 * can persist accumulated deltas without the engine knowing about storage.
 */
export function accumulateDeltas(
  existing: Partial<Record<TrainableAttribute, number>>,
  week: Partial<Record<TrainableAttribute, number>>,
  base: EnginePlayer,
): Partial<Record<TrainableAttribute, number>> {
  const out = { ...existing };

  for (const [attr, movement] of Object.entries(week)) {
    const key = attr as TrainableAttribute;
    const baseValue = base[key];
    const current = out[key] ?? 0;
    const next = current + movement;

    // Clamp the delta, not the sum, so the stored figure always describes how
    // far the player has moved from the imported data.
    //
    // Both bounds are held on the safe side of zero. Outfielders have their
    // goalkeeping attributes stored as 0, which is below the floor, and a bound
    // of `floor - base` would be positive there: the clamp would hand every
    // outfielder ten free points of goalkeeping for doing nothing.
    const maxDelta = Math.max(0, TRAINING.attributeCeiling - baseValue);
    const minDelta = Math.min(0, TRAINING.attributeFloor - baseValue);
    out[key] = Math.max(minDelta, Math.min(maxDelta, next));
  }

  return out;
}

/** Applies stored deltas to a player's attributes. Rounds only for display. */
export function applyDeltas<T extends EnginePlayer>(
  player: T,
  deltas: Partial<Record<TrainableAttribute, number>> | null | undefined,
): T {
  if (!deltas) return player;

  const out = { ...player };
  for (const [attr, movement] of Object.entries(deltas)) {
    const key = attr as TrainableAttribute;
    out[key] = Math.max(
      TRAINING.attributeFloor,
      Math.min(TRAINING.attributeCeiling, Math.round(player[key] + movement)),
    ) as T[TrainableAttribute];
  }
  return out;
}

export function isTrainingFocus(value: string): value is TrainingFocus {
  return value in FOCUS_ATTRIBUTES;
}
