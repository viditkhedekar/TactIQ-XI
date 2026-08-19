/**
 * Reads the committed Premier League slice into engine players.
 *
 * This is the bridge between the source export's column names and the engine's
 * vocabulary. It exists separately from the database importer so the engine
 * can be exercised from a CLI with no database at all, which is how the
 * simulation gets calibrated.
 */

import { parse } from "csv-parse/sync";
import fs from "node:fs";
import path from "node:path";
import type { EnginePlayer, Position } from "@/engine/types";
import { PL_CLUBS } from "./clubs";

export type RawPlayerRow = Record<string, string>;

const VALID_POSITIONS: Position[] = [
  "GK", "CB", "LB", "RB", "LWB", "RWB", "CDM", "CM", "CAM", "LM", "RM", "LW", "RW", "CF", "ST",
];

/** Parses "CM, CDM" into typed positions, discarding anything unrecognised. */
export function parsePositions(value: string): Position[] {
  const parsed = value
    .split(",")
    .map((p) => p.trim().toUpperCase())
    .filter((p): p is Position => (VALID_POSITIONS as string[]).includes(p));

  // A player with no usable position is treated as a midfielder rather than
  // being dropped: losing squad members would break lineup selection.
  return parsed.length > 0 ? parsed : ["CM"];
}

/**
 * Reads a numeric column. Blank cells are common and meaningful in the source
 * data (keepers have no outfield aggregates, outfielders have no keeper
 * speed), so a missing value becomes the supplied fallback rather than NaN.
 */
export function num(row: RawPlayerRow, key: string, fallback = 0): number {
  const raw = row[key];
  if (raw === undefined || raw === "") return fallback;
  // Some columns carry values like "86+3" for in-position bonuses.
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? fallback : value;
}

/** Converts one source row into an engine player. */
export function rowToPlayer(row: RawPlayerRow): EnginePlayer {
  const positions = parsePositions(row.player_positions ?? "");
  const isGk = positions.includes("GK");

  return {
    id: num(row, "player_id"),
    name: row.short_name || row.long_name || `Player ${row.player_id}`,
    clubId: num(row, "club_team_id"),
    positions,
    isGk,
    overall: num(row, "overall", 55),
    age: num(row, "age", 25),

    crossing: num(row, "attacking_crossing", 40),
    finishing: num(row, "attacking_finishing", 40),
    headingAccuracy: num(row, "attacking_heading_accuracy", 40),
    shortPassing: num(row, "attacking_short_passing", 45),
    volleys: num(row, "attacking_volleys", 35),
    dribbling: num(row, "skill_dribbling", 40),
    curve: num(row, "skill_curve", 40),
    fkAccuracy: num(row, "skill_fk_accuracy", 35),
    longPassing: num(row, "skill_long_passing", 45),
    ballControl: num(row, "skill_ball_control", 45),

    acceleration: num(row, "movement_acceleration", 50),
    sprintSpeed: num(row, "movement_sprint_speed", 50),
    agility: num(row, "movement_agility", 50),
    reactions: num(row, "movement_reactions", 50),
    balance: num(row, "movement_balance", 50),
    jumping: num(row, "power_jumping", 50),
    stamina: num(row, "power_stamina", 55),
    strength: num(row, "power_strength", 55),

    shotPower: num(row, "power_shot_power", 45),
    longShots: num(row, "power_long_shots", 35),
    aggression: num(row, "mentality_aggression", 50),
    interceptions: num(row, "mentality_interceptions", 40),
    positioning: num(row, "mentality_positioning", 40),
    vision: num(row, "mentality_vision", 45),
    penalties: num(row, "mentality_penalties", 40),
    composure: num(row, "mentality_composure", 50),

    marking: num(row, "defending_marking_awareness", 35),
    standingTackle: num(row, "defending_standing_tackle", 35),
    slidingTackle: num(row, "defending_sliding_tackle", 35),

    gkDiving: num(row, "goalkeeping_diving"),
    gkHandling: num(row, "goalkeeping_handling"),
    gkKicking: num(row, "goalkeeping_kicking"),
    gkPositioning: num(row, "goalkeeping_positioning"),
    gkReflexes: num(row, "goalkeeping_reflexes"),
    gkSpeed: num(row, "goalkeeping_speed", isGk ? 50 : 0),

    fitness: 100,
    form: 6.5,
  };
}

const DATA_PATH = path.join(process.cwd(), "data", "pl-players.csv");

/** Reads the whole committed slice, grouped by club. */
export function loadPlayersByClub(csvPath: string = DATA_PATH): Map<number, EnginePlayer[]> {
  if (!fs.existsSync(csvPath)) {
    throw new Error(
      `Player data not found at ${csvPath}. Run "npm run data:extract" to regenerate it.`,
    );
  }

  const rows: RawPlayerRow[] = parse(fs.readFileSync(csvPath), {
    columns: true,
    skip_empty_lines: true,
  });

  const byClub = new Map<number, EnginePlayer[]>();
  for (const club of PL_CLUBS) byClub.set(club.id, []);

  for (const row of rows) {
    const player = rowToPlayer(row);
    const squad = byClub.get(player.clubId);
    if (squad) squad.push(player);
  }

  return byClub;
}

/** Every player in the slice, flat. */
export function loadPlayers(csvPath?: string): EnginePlayer[] {
  return [...loadPlayersByClub(csvPath).values()].flat();
}
