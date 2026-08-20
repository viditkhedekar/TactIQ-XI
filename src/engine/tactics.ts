/**
 * Formations and the tactical modifiers that make instructions matter.
 *
 * The point of a manager game is that these choices change what happens on the
 * pitch, not just what the screen says. Every function here feeds the match
 * loop directly: how many chances a side creates, what kind of chances they
 * are, how often they foul, and how fast their players tire.
 */

import {
  CHANCES,
  CHANCE_TYPE_WEIGHTS,
  DISCIPLINE,
  FATIGUE,
  POSSESSION,
  SHAPE,
} from "./constants";
import type {
  ChanceType,
  FormationName,
  Instruction,
  SetPiecePlan,
  Slot,
  TeamTactics,
} from "./types";

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

export const DEFAULT_SET_PIECES: SetPiecePlan = {
  corners: null,
  freeKicks: null,
  penalties: null,
  throwIns: null,
  cornerDelivery: "whipped",
};

export const DEFAULT_TACTICS: TeamTactics = {
  formation: "4-3-3",
  mentality: 3,
  pressing: 3,
  tempo: 3,
  width: 3,
  directness: 3,
  defensiveLine: 3,
  closingDown: 3,
  tackling: 3,
  offsideTrap: false,
  finalThird: "mixed",
  passingFocus: "mixed",
  keeperDistribution: "mixed",
  setPieces: DEFAULT_SET_PIECES,
  captainId: null,
};

/**
 * Fills a partial or outdated plan out into a complete one.
 *
 * Team tactics are serialized into the live match state and into the career
 * row, so a match already in progress when an instruction is added would
 * otherwise come back with holes in it. Everything missing falls back to the
 * neutral default, which by design plays exactly as the engine did before that
 * instruction existed.
 */
export function normaliseTactics(input: Partial<TeamTactics> | null | undefined): TeamTactics {
  if (!input) return { ...DEFAULT_TACTICS, setPieces: { ...DEFAULT_SET_PIECES } };

  const slider = (value: unknown, fallback: Instruction): Instruction =>
    typeof value === "number" && Number.isFinite(value)
      ? (Math.max(1, Math.min(5, Math.round(value))) as Instruction)
      : fallback;

  const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    typeof value === "string" && (allowed as readonly string[]).includes(value)
      ? (value as T)
      : fallback;

  const playerId = (value: unknown): number | null =>
    typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;

  const setPieces = input.setPieces ?? DEFAULT_SET_PIECES;

  return {
    formation: input.formation && isFormationName(input.formation)
      ? input.formation
      : DEFAULT_TACTICS.formation,
    mentality: slider(input.mentality, 3),
    pressing: slider(input.pressing, 3),
    tempo: slider(input.tempo, 3),
    width: slider(input.width, 3),
    directness: slider(input.directness, 3),
    defensiveLine: slider(input.defensiveLine, 3),
    closingDown: slider(input.closingDown, 3),
    tackling: slider(input.tackling, 3),
    offsideTrap: input.offsideTrap === true,
    finalThird: oneOf(input.finalThird, FINAL_THIRD_OPTIONS, "mixed"),
    passingFocus: oneOf(input.passingFocus, PASSING_FOCUS_OPTIONS, "mixed"),
    keeperDistribution: oneOf(input.keeperDistribution, KEEPER_DISTRIBUTION_OPTIONS, "mixed"),
    setPieces: {
      corners: playerId(setPieces.corners),
      freeKicks: playerId(setPieces.freeKicks),
      penalties: playerId(setPieces.penalties),
      throwIns: playerId(setPieces.throwIns),
      cornerDelivery: oneOf(setPieces.cornerDelivery, CORNER_DELIVERY_OPTIONS, "whipped"),
    },
    captainId: playerId(input.captainId),
  };
}

export const FINAL_THIRD_OPTIONS = ["work_ball", "mixed", "shoot_early"] as const;
export const PASSING_FOCUS_OPTIONS = ["left", "centre", "right", "mixed"] as const;
export const KEEPER_DISTRIBUTION_OPTIONS = ["short", "mixed", "long"] as const;
export const CORNER_DELIVERY_OPTIONS = ["near_post", "far_post", "short", "whipped"] as const;

/* ------------------------------------------------------------------ styles */

export type TacticalStyleName =
  | "balanced"
  | "gegenpress"
  | "tiki_taka"
  | "wing_play"
  | "counter_attack"
  | "park_the_bus"
  | "direct"
  | "control";

/**
 * Named ways of playing.
 *
 * A style is a set of instructions, not a separate mechanism: picking one fills
 * in every slider and then gets out of the way, so a manager can take
 * Gegenpress as a starting point and pull the line back without the game
 * arguing. That keeps every effect in one place rather than having some
 * behaviour hidden behind a label.
 */
export type TacticalStyle = {
  name: TacticalStyleName;
  label: string;
  blurb: string;
  instructions: Omit<TeamTactics, "formation" | "setPieces" | "captainId">;
};

function style(
  name: TacticalStyleName,
  label: string,
  blurb: string,
  instructions: Partial<Omit<TeamTactics, "formation" | "setPieces" | "captainId">>,
): TacticalStyle {
  const base = normaliseTactics(instructions);
  return {
    name,
    label,
    blurb,
    instructions: {
      mentality: base.mentality,
      pressing: base.pressing,
      tempo: base.tempo,
      width: base.width,
      directness: base.directness,
      defensiveLine: base.defensiveLine,
      closingDown: base.closingDown,
      tackling: base.tackling,
      offsideTrap: base.offsideTrap,
      finalThird: base.finalThird,
      passingFocus: base.passingFocus,
      keeperDistribution: base.keeperDistribution,
    },
  };
}

export const TACTICAL_STYLES: Record<TacticalStyleName, TacticalStyle> = {
  balanced: style("balanced", "Balanced", "No strong opinions. A sensible starting point.", {}),

  gegenpress: style(
    "gegenpress",
    "Gegenpress",
    "Win it back the instant you lose it, high up the pitch. Exhausting, and it leaves space behind.",
    {
      mentality: 4,
      pressing: 5,
      tempo: 4,
      width: 3,
      directness: 3,
      defensiveLine: 5,
      closingDown: 5,
      tackling: 4,
      offsideTrap: true,
      finalThird: "mixed",
      keeperDistribution: "short",
    },
  ),

  tiki_taka: style(
    "tiki_taka",
    "Tiki-taka",
    "Keep the ball until a gap appears. Patient, narrow, and it needs technicians.",
    {
      mentality: 3,
      pressing: 4,
      tempo: 2,
      width: 2,
      directness: 1,
      defensiveLine: 4,
      closingDown: 4,
      tackling: 2,
      finalThird: "work_ball",
      passingFocus: "centre",
      keeperDistribution: "short",
    },
  ),

  wing_play: style(
    "wing_play",
    "Wing play",
    "Get it wide, get it in the box. Wants quick wingers and someone to attack the cross.",
    {
      mentality: 4,
      pressing: 3,
      tempo: 4,
      width: 5,
      directness: 4,
      defensiveLine: 3,
      closingDown: 3,
      tackling: 3,
      finalThird: "mixed",
      keeperDistribution: "mixed",
    },
  ),

  counter_attack: style(
    "counter_attack",
    "Counter attack",
    "Sit off, soak it up, and break at pace the moment you win it.",
    {
      mentality: 2,
      pressing: 2,
      tempo: 5,
      width: 3,
      directness: 5,
      defensiveLine: 2,
      closingDown: 2,
      tackling: 3,
      finalThird: "mixed",
      keeperDistribution: "long",
    },
  ),

  park_the_bus: style(
    "park_the_bus",
    "Park the bus",
    "Everyone behind the ball. You will not score many, and you will not concede many either.",
    {
      mentality: 1,
      pressing: 1,
      tempo: 2,
      width: 2,
      directness: 4,
      defensiveLine: 1,
      closingDown: 2,
      tackling: 4,
      finalThird: "shoot_early",
      keeperDistribution: "long",
    },
  ),

  direct: style(
    "direct",
    "Direct",
    "Skip the midfield. Long balls forward and second balls fought for.",
    {
      mentality: 4,
      pressing: 3,
      tempo: 4,
      width: 4,
      directness: 5,
      defensiveLine: 3,
      closingDown: 3,
      tackling: 4,
      finalThird: "shoot_early",
      keeperDistribution: "long",
    },
  ),

  control: style(
    "control",
    "Control",
    "Take the ball, take the territory, and wait for them to tire.",
    {
      mentality: 3,
      pressing: 4,
      tempo: 3,
      width: 4,
      directness: 2,
      defensiveLine: 4,
      closingDown: 3,
      tackling: 3,
      finalThird: "work_ball",
      keeperDistribution: "short",
    },
  ),
};

export const TACTICAL_STYLE_NAMES = Object.keys(TACTICAL_STYLES) as TacticalStyleName[];

export function isTacticalStyle(value: string): value is TacticalStyleName {
  return value in TACTICAL_STYLES;
}

/**
 * Which style a set of instructions currently matches, or null when the manager
 * has moved away from all of them. Lets the screen say "Gegenpress" until it
 * has to say "Gegenpress, edited".
 */
export function matchingStyle(tactics: TeamTactics): TacticalStyleName | null {
  for (const name of TACTICAL_STYLE_NAMES) {
    const wanted = TACTICAL_STYLES[name].instructions;
    const same = (Object.keys(wanted) as (keyof typeof wanted)[]).every(
      (key) => tactics[key] === wanted[key],
    );
    if (same) return name;
  }
  return null;
}

/** Applies a style, leaving shape, set pieces and the armband alone. */
export function applyStyle(current: TeamTactics, name: TacticalStyleName): TeamTactics {
  return { ...current, ...TACTICAL_STYLES[name].instructions };
}

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

  // Playing out from the back keeps the ball; going long gives it away.
  share += SHAPE.keeperDistribution[home.keeperDistribution].possession;
  share -= SHAPE.keeperDistribution[away.keeperDistribution].possession;

  // Closing down everywhere wins it back more often than holding shape does.
  share += (home.closingDown - 3) * POSSESSION.pressingWeight * 0.5;
  share -= (away.closingDown - 3) * POSSESSION.pressingWeight * 0.5;

  return Math.max(POSSESSION.min, Math.min(POSSESSION.max, share));
}

/**
 * How solid a side is beyond the raw quality of its defenders.
 *
 * Only tackling appears here, and that is the point. It is tempting to make a
 * high line and hard closing down into defensive bonuses as well, but they are
 * not: they are trades, and they are already paid for in `chanceTypeWeights`,
 * where a high line concedes balls in behind and a passive block concedes shots
 * from range. Adding a flat bonus on top turned every instruction into a buff,
 * and because the AI keys its choices off how strong it is, favourites stacked
 * every advantage at once and the division pulled apart. Tackling earns its
 * place because it is paid for directly in fouls and cards.
 */
export function defensiveDiscipline(tactics: TeamTactics): number {
  return (
    fromInstruction(SHAPE.tacklingDefenceBonus, tactics.tackling) *
    fromInstruction(SHAPE.closingDefenceBonus, tactics.closingDown)
  );
}

/**
 * How much a side's own shape helps it create.
 *
 * Squeezing up compresses the pitch and wins the ball closer to the opposition
 * goal. The cost is not here: it is the space in behind, which shows up as the
 * opponent's through balls and counters.
 */
export function shapeAttackMultiplier(tactics: TeamTactics): number {
  return (
    fromInstruction(SHAPE.lineCompressionBonus, tactics.defensiveLine) *
    SHAPE.finalThird[tactics.finalThird].moments
  );
}

/**
 * Whether an attacker is caught by the offside trap.
 *
 * Only meaningful with a high line, hence the scaling: a side sitting on its
 * own box has nobody to catch offside. Returns zero when the trap is off, so
 * the roll can be skipped entirely and the RNG stream left alone.
 */
export function offsideTrapChance(tactics: TeamTactics): number {
  if (!tactics.offsideTrap) return 0;
  return (
    SHAPE.offsideTrapCatchRate * fromInstruction(SHAPE.offsideTrapLineScaling, tactics.defensiveLine)
  );
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
  rate *= shapeAttackMultiplier(own);

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
  /**
   * The defending side's instructions. Optional so existing callers and tests
   * keep working, in which case the defence is treated as neutral and none of
   * the terms below move anything.
   */
  opponentTactics?: TeamTactics,
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

  // What the side does once it gets there: work an opening, or have a go.
  const third = SHAPE.finalThird[tactics.finalThird];
  w.long_shot *= third.long_shot;
  w.through_ball *= third.through_ball;
  w.cut_inside *= third.cut_inside;
  w.cross *= third.cross;

  // Which channel they look for.
  const focus = SHAPE.passingFocus[tactics.passingFocus];
  w.cross *= focus.cross;
  w.cut_inside *= focus.cut_inside;
  w.through_ball *= focus.through_ball;

  // The keeper skipping the midfield turns possession into transitions.
  w.counter *= SHAPE.keeperDistribution[tactics.keeperDistribution].ownCounter;

  // How the opponent sets up decides what is available against them. A deep,
  // passive block concedes shots from range and little else; a high line that
  // engages everywhere concedes the ball in behind.
  if (opponentTactics) {
    w.through_ball *= fromInstruction(SHAPE.lineThroughBallRisk, opponentTactics.defensiveLine);
    w.counter *= fromInstruction(SHAPE.lineCounterRisk, opponentTactics.defensiveLine);
    w.long_shot *= fromInstruction(SHAPE.lineLongShotConceded, opponentTactics.defensiveLine);
    w.long_shot *= fromInstruction(SHAPE.closingLongShotConceded, opponentTactics.closingDown);
    w.through_ball *= fromInstruction(
      SHAPE.closingThroughBallConceded,
      opponentTactics.closingDown,
    );
    w.counter *= SHAPE.keeperDistribution[opponentTactics.keeperDistribution].counterConceded;
  }

  for (const key of Object.keys(w) as (keyof typeof w)[]) {
    if (w[key] < 0.05) w[key] = 0.05;
  }
  return w;
}

/**
 * How much the quality of a chance is scaled by the attacking instructions.
 *
 * Working the ball into the box produces better chances than shooting on sight,
 * and committing to one channel makes a side readable. Both are applied to the
 * finished chance rather than to how many are created, so the trade is between
 * volume and quality rather than being a straight gain.
 */
export function chanceQualityMultiplier(tactics: TeamTactics): number {
  return (
    SHAPE.finalThird[tactics.finalThird].xg * SHAPE.passingFocus[tactics.passingFocus].focusPenalty
  );
}

/** Fouls conceded per minute, driven mostly by how hard the side presses. */
export function foulRate(tactics: TeamTactics, avgAggression: number): number {
  const pressing = fromInstruction(DISCIPLINE.pressingFoulMultiplier, tactics.pressing);
  const tackling = fromInstruction(SHAPE.tacklingFoulMultiplier, tactics.tackling);
  const aggression =
    1 + (avgAggression - DISCIPLINE.aggressionPivot) / DISCIPLINE.aggressionScale;
  return DISCIPLINE.baseFoulRate * pressing * tackling * Math.max(0.7, aggression);
}

/**
 * How much likelier a foul is to be carded under these instructions.
 *
 * Separate from the foul rate because diving into tackles does not just produce
 * more fouls, it produces worse ones. A side told to get stuck in should be
 * finishing matches down to ten often enough to think twice about it.
 */
export function cardMultiplier(tactics: TeamTactics): number {
  return fromInstruction(SHAPE.tacklingCardMultiplier, tactics.tackling);
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
  // Leaving your shape to chase the ball costs legs on top of the pressing.
  const closing = fromInstruction(SHAPE.closingDrainMultiplier, tactics.closingDown);
  return FATIGUE.baseDrainPerMinute * slotFactor * staminaFactor * tempo * pressing * closing;
}

/**
 * Clamps a partial tactics update onto an existing one. Used when applying
 * a mid-match change, so a malformed payload cannot push a slider off-scale.
 */
export function applyTacticsChange(
  current: TeamTactics,
  change: Partial<TeamTactics>,
): TeamTactics {
  // Merged onto the current plan and then normalised, so an omitted field keeps
  // what it had and a tampered one is clamped rather than accepted.
  return normaliseTactics({ ...current, ...change });
}
