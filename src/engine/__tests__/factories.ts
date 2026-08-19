/**
 * Test fixtures. Builds engine players and sides without touching the CSV or
 * the database, so unit tests stay fast and independent of real data.
 */

import type {
  EnginePlayer,
  LineupPlayer,
  MatchSide,
  Position,
  Slot,
  TeamTactics,
} from "../types";
import { FORMATIONS } from "../tactics";

let nextId = 1;

/** A player with every attribute at `level`, overridable field by field. */
export function makePlayer(overrides: Partial<EnginePlayer> = {}): EnginePlayer {
  const level = overrides.overall ?? 70;
  const isGk = overrides.isGk ?? false;

  const base: EnginePlayer = {
    id: nextId++,
    name: `Player ${nextId}`,
    clubId: 1,
    positions: isGk ? ["GK"] : ["CM"],
    isGk,
    overall: level,
    age: 26,

    crossing: level,
    finishing: level,
    headingAccuracy: level,
    shortPassing: level,
    volleys: level,
    dribbling: level,
    curve: level,
    fkAccuracy: level,
    longPassing: level,
    ballControl: level,

    acceleration: level,
    sprintSpeed: level,
    agility: level,
    reactions: level,
    balance: level,
    jumping: level,
    stamina: level,
    strength: level,

    shotPower: level,
    longShots: level,
    aggression: level,
    interceptions: level,
    positioning: level,
    vision: level,
    penalties: level,
    composure: level,

    marking: level,
    standingTackle: level,
    slidingTackle: level,

    gkDiving: isGk ? level : 0,
    gkHandling: isGk ? level : 0,
    gkKicking: isGk ? level : 0,
    gkPositioning: isGk ? level : 0,
    gkReflexes: isGk ? level : 0,
    gkSpeed: isGk ? level : 0,

    fitness: 100,
    form: 6.5,
  };

  return { ...base, ...overrides };
}

export function makeLineupPlayer(player: EnginePlayer, slot: Slot): LineupPlayer {
  return {
    player,
    slot,
    fitness: player.fitness,
    yellowCards: 0,
    sentOff: false,
    offAtMinute: null,
    onAtMinute: 0,
    minutesPlayed: 0,
    rating: 6.0,
    goals: 0,
    assists: 0,
    shots: 0,
    saves: 0,
    injured: false,
  };
}

export const DEFAULT_TACTICS: TeamTactics = {
  formation: "4-3-3",
  mentality: 3,
  pressing: 3,
  tempo: 3,
  width: 3,
  directness: 3,
};

/** Natural position for each slot, so generated squads always fit properly. */
const SLOT_POSITION: Record<Slot, Position> = {
  GK: "GK",
  LB: "LB",
  LCB: "CB",
  CB: "CB",
  RCB: "CB",
  RB: "RB",
  LWB: "LWB",
  RWB: "RWB",
  CDM: "CDM",
  LCM: "CM",
  CM: "CM",
  RCM: "CM",
  CAM: "CAM",
  LM: "LM",
  RM: "RM",
  LW: "LW",
  RW: "RW",
  ST: "ST",
  LST: "ST",
  RST: "ST",
};

/** A full side of players naturally suited to their slots. */
export function makeSide(options: {
  clubId?: number;
  clubName?: string;
  level?: number;
  isHome?: boolean;
  isUser?: boolean;
  tactics?: Partial<TeamTactics>;
  benchSize?: number;
}): MatchSide {
  const {
    clubId = 1,
    clubName = "Test FC",
    level = 70,
    isHome = true,
    isUser = false,
    benchSize = 9,
  } = options;

  const tactics: TeamTactics = { ...DEFAULT_TACTICS, ...options.tactics };
  const slots = FORMATIONS[tactics.formation];

  const onPitch = slots.map((slot) => {
    const p = makePlayer({
      clubId,
      overall: level,
      isGk: slot === "GK",
      positions: [SLOT_POSITION[slot]],
      name: `${clubName} ${slot}`,
    });
    return makeLineupPlayer(p, slot);
  });

  const benchSlots: Slot[] = ["GK", "CB", "LB", "CDM", "CM", "CAM", "LW", "RW", "ST"];
  const bench = benchSlots.slice(0, benchSize).map((slot) => {
    const p = makePlayer({
      clubId,
      overall: level - 5,
      isGk: slot === "GK",
      positions: [SLOT_POSITION[slot]],
      name: `${clubName} sub ${slot}`,
    });
    return makeLineupPlayer(p, slot);
  });

  return { clubId, clubName, tactics, onPitch, bench, subsUsed: 0, isHome, isUser };
}
