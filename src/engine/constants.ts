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
