/**
 * Database schema.
 *
 * The central decision here is the split between reference data and career
 * state. `clubs` and `players` are global and read-only: imported once from
 * the source export and never written to during play. Everything that changes
 * as a career progresses lives in a table keyed by `careerId`.
 *
 * That split is what lets many people play independent saves off one copy of
 * the player data, and it is also where transfers and player development will
 * attach later: as per-career override tables joined over the reference rows,
 * rather than as edits to shared data.
 */

import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  bigint,
  bigserial,
} from "drizzle-orm/pg-core";

/* ---------------------------------------------------------------- reference */

export const clubs = pgTable("clubs", {
  /** The source export's club_team_id, kept so re-imports line up. */
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  shortName: text("short_name").notNull(),
  primaryColor: text("primary_color").notNull(),
  secondaryColor: text("secondary_color").notNull(),
});

export const players = pgTable(
  "players",
  {
    /** The source export's player_id. */
    id: integer("id").primaryKey(),
    clubId: integer("club_id")
      .notNull()
      .references(() => clubs.id),
    shortName: text("short_name").notNull(),
    longName: text("long_name").notNull(),
    positions: text("positions").array().notNull(),
    isGk: boolean("is_gk").notNull(),
    overall: smallint("overall").notNull(),
    potential: smallint("potential").notNull(),
    age: smallint("age").notNull(),
    valueEur: bigint("value_eur", { mode: "number" }),
    wageEur: bigint("wage_eur", { mode: "number" }),
    jersey: smallint("jersey"),
    preferredFoot: text("preferred_foot"),
    weakFoot: smallint("weak_foot"),
    skillMoves: smallint("skill_moves"),
    nationality: text("nationality"),
    heightCm: smallint("height_cm"),
    weightKg: smallint("weight_kg"),
    /** The export's own suggested slot (LCB, ST, SUB, RES), used to seed an XI. */
    clubPosition: text("club_position"),

    // Technical.
    crossing: smallint("crossing").notNull(),
    finishing: smallint("finishing").notNull(),
    headingAccuracy: smallint("heading_accuracy").notNull(),
    shortPassing: smallint("short_passing").notNull(),
    volleys: smallint("volleys").notNull(),
    dribbling: smallint("dribbling").notNull(),
    curve: smallint("curve").notNull(),
    fkAccuracy: smallint("fk_accuracy").notNull(),
    longPassing: smallint("long_passing").notNull(),
    ballControl: smallint("ball_control").notNull(),

    // Physical.
    acceleration: smallint("acceleration").notNull(),
    sprintSpeed: smallint("sprint_speed").notNull(),
    agility: smallint("agility").notNull(),
    reactions: smallint("reactions").notNull(),
    balance: smallint("balance").notNull(),
    jumping: smallint("jumping").notNull(),
    stamina: smallint("stamina").notNull(),
    strength: smallint("strength").notNull(),

    // Mental and shooting.
    shotPower: smallint("shot_power").notNull(),
    longShots: smallint("long_shots").notNull(),
    aggression: smallint("aggression").notNull(),
    interceptions: smallint("interceptions").notNull(),
    positioning: smallint("positioning").notNull(),
    vision: smallint("vision").notNull(),
    penalties: smallint("penalties").notNull(),
    composure: smallint("composure").notNull(),

    // Defending.
    marking: smallint("marking").notNull(),
    standingTackle: smallint("standing_tackle").notNull(),
    slidingTackle: smallint("sliding_tackle").notNull(),

    // Goalkeeping. Zero for outfielders.
    gkDiving: smallint("gk_diving").notNull(),
    gkHandling: smallint("gk_handling").notNull(),
    gkKicking: smallint("gk_kicking").notNull(),
    gkPositioning: smallint("gk_positioning").notNull(),
    gkReflexes: smallint("gk_reflexes").notNull(),
    gkSpeed: smallint("gk_speed").notNull(),
  },
  (table) => [index("players_club_idx").on(table.clubId)],
);

/* ------------------------------------------------------------- career state */

export const careers = pgTable("careers", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Doubles as the login: entering an existing name resumes that career. */
  username: text("username").notNull().unique(),
  clubId: integer("club_id")
    .notNull()
    .references(() => clubs.id),
  season: smallint("season").notNull().default(1),
  /** 1 to 38 while the season runs; 39 once it is complete. */
  currentRound: smallint("current_round").notNull().default(1),
  /** "idle" between rounds, "matchday" while a match is in progress. */
  phase: text("phase").notNull().default("idle"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const fixtures = pgTable(
  "fixtures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    careerId: uuid("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    round: smallint("round").notNull(),
    /** Present from the start so cups need no migration later. */
    competition: text("competition").notNull().default("league"),
    homeClubId: integer("home_club_id")
      .notNull()
      .references(() => clubs.id),
    awayClubId: integer("away_club_id")
      .notNull()
      .references(() => clubs.id),
    kickoffDate: date("kickoff_date"),
    /** "scheduled", "in_progress" or "finished". */
    status: text("status").notNull().default("scheduled"),
    /** Fixed at generation so a match always replays identically. */
    seed: integer("seed").notNull(),
    homeGoals: smallint("home_goals"),
    awayGoals: smallint("away_goals"),
    /** Full-time statistics, stored as they come off the engine. */
    homeStats: jsonb("home_stats"),
    awayStats: jsonb("away_stats"),
  },
  (table) => [
    index("fixtures_career_round_idx").on(table.careerId, table.round),
    unique("fixtures_career_round_home_unique").on(table.careerId, table.round, table.homeClubId),
  ],
);

export const matchEvents = pgTable(
  "match_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    fixtureId: uuid("fixture_id")
      .notNull()
      .references(() => fixtures.id, { onDelete: "cascade" }),
    /** Engine sequence number. Rewinding deletes everything above a value. */
    seq: integer("seq").notNull(),
    minute: smallint("minute").notNull(),
    addedTime: smallint("added_time").notNull().default(0),
    type: text("type").notNull(),
    clubId: integer("club_id"),
    playerId: integer("player_id"),
    secondPlayerId: integer("second_player_id"),
    commentary: text("commentary").notNull(),
    /** Chance type, xG and running score. Kept for later features. */
    data: jsonb("data"),
  },
  (table) => [
    index("match_events_fixture_seq_idx").on(table.fixtureId, table.seq),
    unique("match_events_fixture_seq_unique").on(table.fixtureId, table.seq),
  ],
);

/**
 * The match currently being played, if any. Holds the engine state twice: as
 * it stands now, and as it stood at the start of the current segment. The
 * second copy is what makes a mid-match substitution possible: the server
 * rewinds to it and re-simulates, reproducing the events the manager has
 * already watched before applying the change.
 */
export const liveMatchState = pgTable("live_match_state", {
  fixtureId: uuid("fixture_id")
    .primaryKey()
    .references(() => fixtures.id, { onDelete: "cascade" }),
  careerId: uuid("career_id")
    .notNull()
    .references(() => careers.id, { onDelete: "cascade" }),
  currentMinute: smallint("current_minute").notNull().default(0),
  stateJson: jsonb("state_json").notNull(),
  segmentStartJson: jsonb("segment_start_json").notNull(),
  segmentStartSeq: integer("segment_start_seq").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One row per player per career: everything about them that changes. */
export const careerPlayerState = pgTable(
  "career_player_state",
  {
    careerId: uuid("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    fitness: real("fitness").notNull().default(100),
    form: real("form").notNull().default(6.5),
    injuryType: text("injury_type"),
    injuredUntilRound: smallint("injured_until_round"),
    suspendedUntilRound: smallint("suspended_until_round"),
    seasonYellows: smallint("season_yellows").notNull().default(0),
    apps: integer("apps").notNull().default(0),
    goals: integer("goals").notNull().default(0),
    assists: integer("assists").notNull().default(0),
    minutes: integer("minutes").notNull().default(0),
    yellows: integer("yellows").notNull().default(0),
    reds: integer("reds").notNull().default(0),
    /** Average rating is derived from these two, so it never drifts. */
    ratingSum: real("rating_sum").notNull().default(0),
    ratingCount: integer("rating_count").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.careerId, table.playerId] }),
    index("career_player_state_career_idx").on(table.careerId),
  ],
);

/** The manager's saved shape, instructions and selected side. */
export const careerTactics = pgTable("career_tactics", {
  careerId: uuid("career_id")
    .primaryKey()
    .references(() => careers.id, { onDelete: "cascade" }),
  formation: text("formation").notNull().default("4-3-3"),
  mentality: smallint("mentality").notNull().default(3),
  pressing: smallint("pressing").notNull().default(3),
  tempo: smallint("tempo").notNull().default(3),
  width: smallint("width").notNull().default(3),
  directness: smallint("directness").notNull().default(3),
  /** [{ slot, playerId }] for the eleven starters. */
  lineup: jsonb("lineup").notNull(),
  /** Up to nine substitute player ids. */
  bench: jsonb("bench").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ClubRow = typeof clubs.$inferSelect;
export type PlayerRow = typeof players.$inferSelect;
export type CareerRow = typeof careers.$inferSelect;
export type FixtureRow = typeof fixtures.$inferSelect;
export type MatchEventRow = typeof matchEvents.$inferSelect;
export type CareerPlayerStateRow = typeof careerPlayerState.$inferSelect;
export type CareerTacticsRow = typeof careerTactics.$inferSelect;
export type LiveMatchStateRow = typeof liveMatchState.$inferSelect;
