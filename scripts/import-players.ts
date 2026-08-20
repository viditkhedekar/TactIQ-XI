/**
 * Loads the committed player slice into the database.
 *
 * Reference data only: this writes `clubs` and `players`, which no career ever
 * modifies. It is safe to re-run at any time, including against a database
 * with careers in progress, because rows are upserted by their source ids.
 *
 *   npm run db:import
 */

import { parse } from "csv-parse/sync";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { clubs, players } from "../src/db/schema";
import { PL_CLUBS } from "../src/data/clubs";
import {
  ALL_LOWER_CLUBS,
  CHAMPIONSHIP_CLUB_IDS,
  TIER_STRENGTH,
} from "../src/data/lowerClubs";
import { generateSquad } from "../src/data/generateSquad";
import { parsePositions, num } from "../src/data/loadPlayers";

type Row = Record<string, string>;

async function main(): Promise<void> {
  const csvPath = process.argv[2] ?? path.join(process.cwd(), "data", "pl-players.csv");

  if (!fs.existsSync(csvPath)) {
    console.error(`Player data not found at ${csvPath}`);
    console.error('Run "npm run data:extract" to regenerate it from the source export.');
    process.exit(1);
  }

  const rows: Row[] = parse(fs.readFileSync(csvPath), {
    columns: true,
    skip_empty_lines: true,
  });

  const allowedClubIds = new Set(PL_CLUBS.map((c) => c.id));

  console.log(`Read ${rows.length} rows from ${path.relative(process.cwd(), csvPath)}`);

  /* -------------------------------------------------------------------- clubs */

  // The top flight plus everybody below it. The lower clubs have to exist here
  // from the start rather than being created when a career first promotes one:
  // careers reference clubs by id, and a club that appears halfway through a
  // save would have no players and no history behind it.
  const allClubs = [...PL_CLUBS, ...ALL_LOWER_CLUBS];

  await db
    .insert(clubs)
    .values(allClubs)
    .onConflictDoUpdate({
      target: clubs.id,
      set: {
        name: sql`excluded.name`,
        shortName: sql`excluded.short_name`,
        primaryColor: sql`excluded.primary_color`,
        secondaryColor: sql`excluded.secondary_color`,
      },
    });

  console.log(
    `Upserted ${allClubs.length} clubs (${PL_CLUBS.length} top flight, ${ALL_LOWER_CLUBS.length} below)`,
  );

  /* ------------------------------------------------------------------ players */

  const seen = new Set<number>();
  const values = [];
  let skipped = 0;

  for (const row of rows) {
    const clubId = num(row, "club_team_id");
    if (!allowedClubIds.has(clubId)) {
      skipped++;
      continue;
    }

    const id = num(row, "player_id");
    // The source export can repeat a player across update snapshots; the first
    // occurrence wins so the insert does not fail on a duplicate key.
    if (seen.has(id)) {
      skipped++;
      continue;
    }
    seen.add(id);

    const positions = parsePositions(row.player_positions ?? "");
    const isGk = positions.includes("GK");

    values.push({
      id,
      clubId,
      shortName: row.short_name || row.long_name || `Player ${id}`,
      longName: row.long_name || row.short_name || `Player ${id}`,
      positions,
      isGk,
      overall: num(row, "overall", 55),
      potential: num(row, "potential", num(row, "overall", 55)),
      age: num(row, "age", 25),
      valueEur: num(row, "value_eur") || null,
      wageEur: num(row, "wage_eur") || null,
      jersey: num(row, "club_jersey_number") || null,
      preferredFoot: row.preferred_foot || null,
      weakFoot: num(row, "weak_foot", 3),
      skillMoves: num(row, "skill_moves", 2),
      nationality: row.nationality_name || null,
      heightCm: num(row, "height_cm") || null,
      weightKg: num(row, "weight_kg") || null,
      clubPosition: row.club_position || null,

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
    });
  }

  if (values.length === 0) {
    console.error("No players matched the Premier League club whitelist.");
    process.exit(1);
  }

  /* ------------------------------------------------- invented lower squads */

  /*
   * Squads for the clubs below the top flight.
   *
   * Ids are laid out in fixed blocks of `ID_BLOCK` per club starting at
   * `GENERATED_ID_BASE`, so a given club's players always occupy the same ids.
   * That is what makes re-running the importer an upsert rather than a way to
   * accumulate duplicate squads, and it keeps any career_player_state rows
   * pointing at the players they were written for.
   */
  const GENERATED_ID_BASE = 900_000;
  const ID_BLOCK = 100;

  for (const [index, club] of ALL_LOWER_CLUBS.entries()) {
    const tier = CHAMPIONSHIP_CLUB_IDS.includes(club.id)
      ? TIER_STRENGTH.championship
      : TIER_STRENGTH.lower;

    values.push(
      ...generateSquad(club.id, tier.mean, tier.spread, GENERATED_ID_BASE + index * ID_BLOCK),
    );
  }

  console.log(
    `Generated ${values.length - seen.size} players for ${ALL_LOWER_CLUBS.length} lower clubs`,
  );

  // Every non-key column is refreshed, so a re-import picks up corrected data.
  const updateSet = Object.fromEntries(
    Object.keys(values[0])
      .filter((key) => key !== "id")
      .map((key) => {
        const column = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
        return [key, sql.raw(`excluded.${column}`)];
      }),
  );

  // Chunked: a single statement with 547 rows of 54 columns exceeds the
  // parameter limit Postgres accepts.
  const CHUNK = 100;
  for (let i = 0; i < values.length; i += CHUNK) {
    await db
      .insert(players)
      .values(values.slice(i, i + CHUNK))
      .onConflictDoUpdate({ target: players.id, set: updateSet });
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(players);

  const perClub = await db
    .select({ clubId: players.clubId, n: sql<number>`count(*)::int` })
    .from(players)
    .groupBy(players.clubId);

  console.log(`Imported ${values.length} players (${skipped} rows skipped)`);
  console.log(`Database now holds ${count} players across ${perClub.length} clubs`);

  const names = new Map(PL_CLUBS.map((c) => [c.id, c.name]));
  for (const row of perClub.sort((a, b) => (names.get(a.clubId) ?? "").localeCompare(names.get(b.clubId) ?? ""))) {
    console.log(`  ${(names.get(row.clubId) ?? String(row.clubId)).padEnd(26)} ${row.n}`);
  }

  process.exit(0);

}

main();
