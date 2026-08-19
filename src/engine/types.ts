/**
 * The engine's vocabulary.
 *
 * Everything here is a plain serializable object. The engine imports nothing
 * from Next, React or the database layer: it takes players and tactics in,
 * and returns events and a new state out. That keeps it unit-testable from a
 * CLI and lets the whole match state round-trip through a jsonb column.
 */

import type { RngState } from "./rng";

/** Pitch slots a player can be assigned to. Drives the position-fit matrix. */
export type Slot =
  | "GK"
  | "LB"
  | "LCB"
  | "CB"
  | "RCB"
  | "RB"
  | "LWB"
  | "RWB"
  | "CDM"
  | "LCM"
  | "CM"
  | "RCM"
  | "CAM"
  | "LM"
  | "RM"
  | "LW"
  | "RW"
  | "ST"
  | "LST"
  | "RST";

/** Natural positions as listed in the source data. */
export type Position =
  | "GK"
  | "CB"
  | "LB"
  | "RB"
  | "LWB"
  | "RWB"
  | "CDM"
  | "CM"
  | "CAM"
  | "LM"
  | "RM"
  | "LW"
  | "RW"
  | "CF"
  | "ST";

export type FormationName = "4-4-2" | "4-3-3" | "4-2-3-1" | "3-5-2" | "5-4-1" | "4-1-4-1";

/** Team instructions. Every slider is 1..5, 3 being balanced. */
export type Instruction = 1 | 2 | 3 | 4 | 5;

export type TeamTactics = {
  formation: FormationName;
  /** 1 very defensive .. 5 very attacking */
  mentality: Instruction;
  /** 1 stand off .. 5 press high and hard */
  pressing: Instruction;
  /** 1 slow build .. 5 fast */
  tempo: Instruction;
  /** 1 narrow .. 5 wide */
  width: Instruction;
  /** 1 patient short passing .. 5 direct/long */
  directness: Instruction;
};

/**
 * A player as the engine sees them: raw attributes plus the career-scoped
 * condition that changes between matches. The engine never loads these itself.
 */
export type EnginePlayer = {
  id: number;
  name: string;
  clubId: number;
  positions: Position[];
  isGk: boolean;
  overall: number;
  age: number;

  // Technical
  crossing: number;
  finishing: number;
  headingAccuracy: number;
  shortPassing: number;
  volleys: number;
  dribbling: number;
  curve: number;
  fkAccuracy: number;
  longPassing: number;
  ballControl: number;

  // Physical
  acceleration: number;
  sprintSpeed: number;
  agility: number;
  reactions: number;
  balance: number;
  jumping: number;
  stamina: number;
  strength: number;

  // Mental / shooting
  shotPower: number;
  longShots: number;
  aggression: number;
  interceptions: number;
  positioning: number;
  vision: number;
  penalties: number;
  composure: number;

  // Defending
  marking: number;
  standingTackle: number;
  slidingTackle: number;

  // Goalkeeping (0 for outfielders)
  gkDiving: number;
  gkHandling: number;
  gkKicking: number;
  gkPositioning: number;
  gkReflexes: number;
  gkSpeed: number;

  /** 0..100 condition carried between matches. */
  fitness: number;
  /** Rolling average of recent match ratings, ~4.0..9.0. */
  form: number;
};

/** A player occupying a pitch slot, with their live in-match condition. */
export type LineupPlayer = {
  player: EnginePlayer;
  slot: Slot;
  /** Live fitness, drains through the match. */
  fitness: number;
  yellowCards: number;
  sentOff: boolean;
  /** Set when the player leaves the pitch. */
  offAtMinute: number | null;
  onAtMinute: number;
  minutesPlayed: number;
  /** Running match rating, 4.0..10.0. */
  rating: number;
  goals: number;
  assists: number;
  shots: number;
  saves: number;
  /** Set when an injury forces or recommends a substitution. */
  injured: boolean;
};

export type MatchSide = {
  clubId: number;
  clubName: string;
  tactics: TeamTactics;
  onPitch: LineupPlayer[];
  bench: LineupPlayer[];
  /** Players already used as substitutes, by id. */
  subsUsed: number;
  isHome: boolean;
  /** Set by the caller when this side is the human manager's team. */
  isUser: boolean;
};

export type MatchStats = {
  possession: number;
  shots: number;
  shotsOnTarget: number;
  bigChances: number;
  corners: number;
  fouls: number;
  yellowCards: number;
  redCards: number;
  xg: number;
};

export type MatchEventType =
  | "kickoff"
  | "chance"
  | "shot_off"
  | "shot_blocked"
  | "save"
  | "goal"
  | "penalty_awarded"
  | "penalty_missed"
  | "foul"
  | "yellow"
  | "red"
  | "injury"
  | "sub"
  | "tactic_change"
  | "halftime"
  | "fulltime"
  /* Colour. See COLOUR_EVENT_TYPES below for what these are and are not. */
  | "woodwork"
  | "goal_line_clearance"
  | "offside"
  | "var_check"
  | "corner"
  | "buildup"
  | "atmosphere"
  | "pundit";

/**
 * Every event that is a shot at goal, and therefore counts in the statistics.
 *
 * `woodwork` and `goal_line_clearance` belong here and not with the colour
 * below. They are ordinary misses and blocks that have been given a better
 * description after the fact, so they carry real xG and must be counted once,
 * exactly like the `shot_off` and `shot_blocked` they replaced.
 */
export const SHOT_EVENT_TYPES = [
  "goal",
  "save",
  "shot_off",
  "shot_blocked",
  "woodwork",
  "goal_line_clearance",
  "penalty_missed",
] as const satisfies readonly MatchEventType[];

export function isShotEvent(type: MatchEventType): boolean {
  return (SHOT_EVENT_TYPES as readonly string[]).includes(type);
}

/** Shot events that were on target. Used by the statistics panel. */
export const ON_TARGET_EVENT_TYPES = ["goal", "save"] as const satisfies readonly MatchEventType[];

/**
 * Events that exist purely to make the ticker read like a broadcast.
 *
 * None of them change the score, the statistics or a player's rating, and none
 * of them consume the match RNG: they are generated from a separate stream
 * derived from the fixture and the minute (see `colourRng` in match.ts). That
 * separation is deliberate and load-bearing. The engine is calibrated against
 * real Premier League rates, and drawing colour from the main generator would
 * shift every subsequent roll and silently invalidate the whole tuning pass.
 *
 * Every event listed here carries `data.colour`, so a consumer can drop the
 * lot without knowing the names.
 */
export const COLOUR_EVENT_TYPES = [
  "offside",
  "var_check",
  "corner",
  "buildup",
  "atmosphere",
  "pundit",
] as const satisfies readonly MatchEventType[];

export function isColourEvent(type: MatchEventType): boolean {
  return (COLOUR_EVENT_TYPES as readonly string[]).includes(type);
}

/** Where a chance came from. Shapes commentary and the odds of scoring. */
export type ChanceType =
  | "through_ball"
  | "cross"
  | "cut_inside"
  | "long_shot"
  | "counter"
  | "set_piece"
  | "penalty";

export type MatchEvent = {
  seq: number;
  minute: number;
  addedTime: number;
  type: MatchEventType;
  clubId: number | null;
  playerId: number | null;
  /** Assister, fouled player, or the player coming on for a substitution. */
  secondPlayerId: number | null;
  commentary: string;
  /** Structured payload kept for later use (stats screens, a 2D replay). */
  data: {
    chanceType?: ChanceType;
    xg?: number;
    homeGoals?: number;
    awayGoals?: number;
    severity?: InjurySeverity;
    outRounds?: number;
    /** Set on colour events so consumers can filter them without a type list. */
    colour?: true;
  } | null;
};

export type InjurySeverity = "knock" | "minor" | "moderate" | "severe";

/** The complete simulation state. Serializes to jsonb and back without loss. */
export type MatchState = {
  fixtureId: string;
  minute: number;
  addedTime: number;
  /** 1 or 2; 0 before kickoff. */
  half: number;
  finished: boolean;
  rng: RngState;
  home: MatchSide;
  away: MatchSide;
  homeGoals: number;
  awayGoals: number;
  homeStats: MatchStats;
  awayStats: MatchStats;
  /** Monotonic counter so persisted events keep a stable order. */
  nextSeq: number;
  /**
   * Minute of the last goal or red card, so ticker colour can stay out of the
   * way while the aftermath is still being described. Optional because states
   * serialized before colour existed do not carry it.
   */
  lastDramaMinute?: number;
};

/** Why simulateSegment stopped. The UI uses this to decide whether to prompt. */
export type SegmentBoundary =
  | "goal"
  | "red_card"
  | "injury"
  | "halftime"
  | "fulltime"
  | "interval";

export type SegmentResult = {
  state: MatchState;
  events: MatchEvent[];
  boundary: SegmentBoundary;
};

/** A manager intervention applied at a pause point. */
export type Substitution = { off: number; on: number };

export type Intervention = {
  tactics?: Partial<TeamTactics>;
  subs?: Substitution[];
};

/** Per-player outcome of a finished match, folded back into career state. */
export type PlayerMatchResult = {
  playerId: number;
  clubId: number;
  minutesPlayed: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  rating: number;
  /** Fitness at the final whistle, before between-round recovery. */
  endFitness: number;
  injury: { severity: InjurySeverity; outRounds: number } | null;
};

export type MatchResult = {
  fixtureId: string;
  homeClubId: number;
  awayClubId: number;
  homeGoals: number;
  awayGoals: number;
  homeStats: MatchStats;
  awayStats: MatchStats;
  events: MatchEvent[];
  players: PlayerMatchResult[];
};
