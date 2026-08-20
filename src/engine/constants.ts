/**
 * Every tunable number in the simulation lives here.
 *
 * The sanity harness (scripts/sim-season.ts) simulates many full seasons and
 * checks the output against real Premier League rates. When a distribution
 * looks wrong, this is the only file that should need editing.
 *
 * Reference targets from recent Premier League seasons:
 *   goals per match     ~2.8
 *   shots per team      ~12.5
 *   shots on target     ~4.3
 *   home win share      ~44%
 *   yellows per match   ~4.0
 *   reds per match      ~0.15
 */

export const MATCH = {
  /** Regulation minutes. Added time is generated on top. */
  minutes: 90,
  /** Added time drawn per half, in minutes. */
  addedTimeFirstHalf: [0, 3] as const,
  addedTimeSecondHalf: [2, 6] as const,
  /** Longest stretch simulated before returning control to the caller. */
  segmentMinutes: 15,
  maxSubs: 5,
};

export const POSSESSION = {
  /** Midfield rating difference that maps to a meaningful possession edge. */
  ratingScale: 13,
  /** Extra share for the home side. */
  homeBonus: 0.015,
  /** Tempo and pressing nudge possession away from the balanced split. */
  tempoWeight: 0.012,
  pressingWeight: 0.016,
  /** Possession never collapses entirely: keeps both sides in the match. */
  min: 0.28,
  max: 0.72,
};

export const CHANCES = {
  /** Combined chance-creating moments per minute across both teams. */
  baseMomentsPerMinute: 0.205,
  /** Home side creates slightly more. */
  homeMomentBonus: 0.025,
  /** Attack minus opponent defence, scaled into a moment-rate multiplier. */
  attackDefenceScale: 48,
  momentRateMin: 0.55,
  momentRateMax: 1.7,
  /** Mentality 1..5 multiplies your own moment rate by these. */
  mentalityAttackMultiplier: [0.82, 0.91, 1.0, 1.1, 1.22] as const,
  /** ...and hands the opponent this multiplier in return. */
  mentalityConcedeMultiplier: [0.84, 0.92, 1.0, 1.09, 1.2] as const,
  /** Fast tempo creates more moments for both sides. */
  tempoMomentMultiplier: [0.93, 0.97, 1.0, 1.04, 1.09] as const,
  /** High pressing forces opponent turnovers into counters. */
  pressTurnoverChance: [0.0, 0.02, 0.04, 0.07, 0.1] as const,
};

/**
 * Base scoring probability by chance type, before shooter and keeper quality.
 * These are the engine's equivalent of xG per shot.
 */
export const CHANCE_TYPES = {
  through_ball: { baseXg: 0.26, onTargetBase: 0.39 },
  cross: { baseXg: 0.13, onTargetBase: 0.32 },
  cut_inside: { baseXg: 0.15, onTargetBase: 0.36 },
  long_shot: { baseXg: 0.05, onTargetBase: 0.26 },
  counter: { baseXg: 0.24, onTargetBase: 0.40 },
  set_piece: { baseXg: 0.1, onTargetBase: 0.31 },
  penalty: { baseXg: 0.78, onTargetBase: 0.86 },
} as const;

/** Relative frequency of each chance type before tactical modifiers. */
export const CHANCE_TYPE_WEIGHTS = {
  through_ball: 1.0,
  cross: 1.5,
  cut_inside: 1.2,
  long_shot: 1.3,
  counter: 0.45,
  set_piece: 0.9,
} as const;

export const SHOOTING = {
  /** Shooter finishing minus defensive pressure, scaled into on-target odds. */
  onTargetScale: 260,
  onTargetMin: 0.2,
  onTargetMax: 0.66,
  /** Keeper rating is subtracted from this before scaling the save. */
  gkPivot: 113,
  gkScale: 50,
  goalMin: 0.03,
  goalMax: 0.88,
  /** A shot that misses the target is sometimes a block instead. */
  blockShare: 0.42,
  /** Chance a blocked shot or wayward effort yields a corner. */
  cornerFromShot: 0.35,
};

export const SET_PIECES = {
  /** Share of fouls in dangerous areas that become penalties. */
  penaltyFromFoul: 0.028,
  /** Corners are tracked for the stats panel and feed set-piece chances. */
  cornerToChance: 0.12,
  /**
   * How a corner delivery reshapes the chance it creates. `xg` scales the
   * quality of the opportunity, `aerial` how much the finish leans on heading
   * rather than composure, and `assist` how likely there is a clear provider.
   */
  cornerDelivery: {
    near_post: { xg: 1.08, aerial: 1.15, assist: 0.95 },
    far_post: { xg: 1.02, aerial: 1.25, assist: 1.0 },
    short: { xg: 0.92, aerial: 0.55, assist: 1.15 },
    whipped: { xg: 1.12, aerial: 1.05, assist: 0.9 },
  } as const,
};

/**
 * The instructions added on top of the original five.
 *
 * Every table is neutral at index 2, which is the default of 3. That is not a
 * convenience: it is what guarantees a squad with no instructions set plays
 * exactly as the engine did before any of this existed, so the season
 * calibration in the README still describes the game.
 */
export const SHAPE = {
  /**
   * Defensive line, 1 deep to 5 squeezed up.
   *
   * A high line compresses the pitch and wins the ball higher, which creates
   * more, but it leaves grass in behind for anyone quick. Both sides of that
   * trade are here, and they are meant to roughly cancel at a neutral setting.
   */
  lineCompressionBonus: [0.94, 0.97, 1.0, 1.04, 1.08] as const,
  /** How much a high line multiplies the opponent's balls in behind. */
  lineThroughBallRisk: [0.72, 0.86, 1.0, 1.2, 1.45] as const,
  /** ...and their counter attacks. */
  lineCounterRisk: [0.78, 0.89, 1.0, 1.15, 1.34] as const,
  /** A deep line invites shots from distance instead. */
  lineLongShotConceded: [1.4, 1.18, 1.0, 0.88, 0.78] as const,

  /**
   * Closing down, 1 hold shape to 5 engage everywhere.
   *
   * Distinct from pressing, which is about intensity. This is about whether the
   * side leaves its shape to go to the ball, so it buys defensive pressure at
   * the cost of the gaps that opens.
   */
  closingDefenceBonus: [0.975, 0.99, 1.0, 1.018, 1.035] as const,
  closingLongShotConceded: [1.35, 1.16, 1.0, 0.86, 0.74] as const,
  closingThroughBallConceded: [0.84, 0.92, 1.0, 1.09, 1.18] as const,
  closingDrainMultiplier: [0.94, 0.97, 1.0, 1.04, 1.09] as const,

  /**
   * Tackling, 1 stay on your feet to 5 get stuck in.
   *
   * Wins more of the ball and costs more cards. The card term is deliberately
   * steeper than the defensive one, because a side that dives into everything
   * should finish matches with ten men often enough to regret it.
   */
  tacklingDefenceBonus: [0.96, 0.98, 1.0, 1.025, 1.05] as const,
  tacklingFoulMultiplier: [0.78, 0.89, 1.0, 1.15, 1.34] as const,
  tacklingCardMultiplier: [0.8, 0.9, 1.0, 1.2, 1.45] as const,

  /**
   * The offside trap. Stepping up catches attackers out, and when it is beaten
   * the man is clean through. Only worth anything with a high line, which is
   * why the effect is scaled by it.
   *
   * The catch rate is low on purpose. An earlier value of 0.55 caught nearly
   * nine in ten balls played in behind and made the trap worth more than half a
   * goal a game, which is not a tactic, it is a cheat code. A real trap catches
   * a fraction of the runs and gives up a clear sight of goal when it does not.
   */
  offsideTrapCatchRate: 0.21,
  offsideTrapBeatenXgBonus: 1.32,
  offsideTrapLineScaling: [0.4, 0.7, 1.0, 1.3, 1.6] as const,

  /**
   * Working the ball into the box against shooting on sight.
   *
   * `moments` is the part that makes this a decision rather than a penalty.
   * Chance type alone only changes how good a chance is, so without it,
   * shooting early was pure downside: the same number of chances, all worse.
   * Having a go from range means more attempts, and working an opening means
   * fewer and better. That is the actual trade a manager is making.
   */
  finalThird: {
    work_ball: { long_shot: 0.5, through_ball: 1.1, cut_inside: 1.1, cross: 0.95, xg: 1.04, moments: 0.9 },
    mixed: { long_shot: 1.0, through_ball: 1.0, cut_inside: 1.0, cross: 1.0, xg: 1.0, moments: 1.0 },
    shoot_early: { long_shot: 2.0, through_ball: 0.92, cut_inside: 0.96, cross: 1.0, xg: 1.0, moments: 1.24 },
  } as const,

  /**
   * Which channel the side works.
   *
   * Deliberately free of a flat penalty. Focusing is not worse than not
   * focusing, it is narrower: it amplifies whichever flank the side is already
   * strong on, so it pays for a team with wingers and costs one without. An
   * earlier flat cost made every focus strictly worse than mixed, which meant
   * the option existed only to be avoided.
   */
  passingFocus: {
    left: { cross: 1.28, cut_inside: 1.08, through_ball: 0.92, focusPenalty: 1.0 },
    right: { cross: 1.28, cut_inside: 1.08, through_ball: 0.92, focusPenalty: 1.0 },
    centre: { cross: 0.74, cut_inside: 1.12, through_ball: 1.26, focusPenalty: 1.0 },
    mixed: { cross: 1.0, cut_inside: 1.0, through_ball: 1.0, focusPenalty: 1.0 },
  } as const,

  /**
   * What the keeper does with it. Playing out keeps the ball and invites the
   * press; going long concedes possession and skips the midfield entirely.
   */
  keeperDistribution: {
    short: { possession: 0.016, counterConceded: 1.5, ownCounter: 0.9, directness: -0.35 },
    mixed: { possession: 0, counterConceded: 1.0, ownCounter: 1.0, directness: 0 },
    long: { possession: -0.012, counterConceded: 0.7, ownCounter: 1.9, directness: 0.4 },
  } as const,
};

/**
 * The captain.
 *
 * Small on purpose. A captain who swung matches would be a hidden fudge, and a
 * captain who did nothing would be a lie on the team sheet. This is a nudge to
 * the ratings around him, biggest when the side is behind and needs settling.
 */
export const CAPTAIN = {
  /** Composure above this starts to help. Below it, the armband is neutral. */
  composurePivot: 70,
  /** Largest effectiveness bonus a truly commanding captain gives teammates. */
  maxTeamBonus: 0.02,
  /** Extra steadying applied while the side is losing. */
  behindMultiplier: 1.6,
  /** Rating drift the captain himself absorbs for the team's performance. */
  ownDriftShare: 1.25,
};

export const DISCIPLINE = {
  /** Fouls per team per minute at neutral pressing. */
  baseFoulRate: 0.115,
  /** Pressing 1..5 multiplies the foul rate. */
  pressingFoulMultiplier: [0.82, 0.91, 1.0, 1.12, 1.26] as const,
  /** Aggression above this raises a defender's share of the fouls. */
  aggressionPivot: 60,
  aggressionScale: 220,
  yellowFromFoul: 0.202,
  /**
   * How much less likely a booked player is to be booked again. He stops
   * diving into tackles and the referee looks for a reason not to send him off.
   */
  bookedCautionFactor: 0.22,
  redFromFoul: 0.0022,
  /** Season yellows that trigger a one-match ban. */
  yellowsForBan: 5,
  redCardBanRounds: 1,
};

export const INJURY = {
  /** Base probability per player per minute. */
  perMinute: 0.0001,
  /** Tiredness multiplies risk: a spent player is far likelier to break down. */
  fatigueWeight: 2.2,
  /** Risk rises with age past this point. */
  agePivot: 29,
  ageWeight: 0.035,
  /** Severity split. Knocks do not force a substitution. */
  severityWeights: { knock: 0.55, minor: 0.3, moderate: 0.12, severe: 0.03 },
  outRounds: {
    knock: [0, 0] as const,
    minor: [1, 2] as const,
    moderate: [3, 6] as const,
    severe: [8, 16] as const,
  },
  /** Fitness penalty a player carries after playing through a knock. */
  knockFitnessPenalty: 6,
};

export const FATIGUE = {
  /** Fitness points lost per minute at neutral settings. */
  baseDrainPerMinute: 0.4,
  /** Stamina 100 drains at (staminaPivot - 1.0); stamina 0 at staminaPivot. */
  staminaPivot: 1.68,
  /** Positional workload. Wing-backs and wingers cover the most ground. */
  slotDrain: {
    GK: 0.15,
    LCB: 0.85,
    CB: 0.85,
    RCB: 0.85,
    LB: 1.1,
    RB: 1.1,
    LWB: 1.2,
    RWB: 1.2,
    CDM: 1.0,
    LCM: 1.08,
    CM: 1.08,
    RCM: 1.08,
    CAM: 1.02,
    LM: 1.12,
    RM: 1.12,
    LW: 1.15,
    RW: 1.15,
    ST: 1.0,
    LST: 1.0,
    RST: 1.0,
  } as const,
  tempoDrainMultiplier: [0.9, 0.95, 1.0, 1.07, 1.15] as const,
  pressingDrainMultiplier: [0.88, 0.94, 1.0, 1.12, 1.25] as const,
  /** Between rounds: recover this share of the gap back to 100. */
  weeklyRecoveryShare: 0.62,
  /** Plus a flat bonus, larger for players who did not feature. */
  weeklyRecoveryFlat: 4,
  weeklyRestBonus: 7,
  /** Effectiveness curve: fitness below this starts to bite hard. */
  effectivenessFloor: 0.7,
};

export const FORM = {
  /** Match ratings feed a rolling average over this many matches. */
  window: 5,
  startingForm: 6.5,
  /** Form maps into an effectiveness multiplier across this span. */
  minForm: 4.5,
  maxForm: 8.5,
  minMultiplier: 0.96,
  maxMultiplier: 1.04,
};

export const RATING = {
  base: 6.0,
  min: 4.0,
  max: 10.0,
  goal: 1.0,
  assist: 0.7,
  shotOnTarget: 0.14,
  shotOff: -0.04,
  keySave: 0.22,
  goalConceded: -0.18,
  cleanSheetDefender: 0.45,
  yellow: -0.3,
  red: -1.2,
  penaltyMissed: -0.7,
  /** Drift applied per 15 minutes based on how the team is doing. */
  teamPerformanceDrift: 0.12,
};

export const HOME_ADVANTAGE = {
  /** Away sides are marginally less composed. */
  awayCompositePenalty: 0.99,
};

/**
 * Ticker colour.
 *
 * None of these affect the simulation. They are drawn from a separate RNG
 * stream, so turning any of them up changes only how much there is to read and
 * never the goals, cards or ratings a match produces. Tune them by watching a
 * match, not by running the season harness.
 */
export const COLOUR = {
  /** Probability per minute of a line about nothing in particular. */
  generalPlayPerMinute: 0.3,
  /** Probability per minute of a crowd or momentum note. */
  atmospherePerMinute: 0.12,
  /** Probability per minute of the summariser saying something. */
  punditPerMinute: 0.09,
  /** Probability per minute of a touchline reaction. */
  touchlinePerMinute: 0.05,
  /** Probability per minute of an attack being flagged offside. */
  offsidePerMinute: 0.055,
  /** Share of off-target shots relabelled as having hit the frame of the goal. */
  woodworkShareOfMisses: 0.07,
  /** Share of blocked shots relabelled as cleared off the line. */
  lineClearanceShareOfBlocks: 0.12,
  /** Share of goals and penalties that get a check before they stand. */
  varCheckShareOfGoals: 0.14,
  /** Share of corners won that are described rather than only counted. */
  cornerNarrationShare: 0.55,
  /**
   * Colour is suppressed for this many minutes after a goal or a red card. The
   * ticker should be busy with the aftermath, not with a note about a throw-in.
   */
  quietMinutesAfterDrama: 2,
};
