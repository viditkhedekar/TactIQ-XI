/**
 * Running a whole season in memory.
 *
 * This is the calibration rig: it plays every fixture with AI managers on both
 * sides, carries fitness and injuries between rounds, and reports the kind of
 * aggregate numbers that can be checked against real football. It is also the
 * exact code path the game uses to simulate the nine fixtures the manager is
 * not personally involved in.
 */

import { aiMinuteHook, chooseFormation, chooseTactics, selectLineup } from "./aiManager";
import { DISCIPLINE } from "./constants";
import { recoverFitness } from "./fatigue";
import { buildMatchResult, createMatchState, simulateToEnd } from "./match";
import { updateForm } from "./playerRating";
import { hash32, type RngState } from "./rng";
import { generateSchedule, ROUNDS_IN_SEASON, type ScheduledFixture } from "./schedule";
import type {
  EnginePlayer,
  FormationName,
  LineupPlayer,
  MatchResult,
  MatchSide,
  Slot,
  TeamTactics,
} from "./types";

/** Career-scoped condition for one player, carried between rounds. */
export type PlayerState = {
  fitness: number;
  form: number;
  injuredUntilRound: number | null;
  suspendedUntilRound: number | null;
  seasonYellows: number;
  apps: number;
  goals: number;
  assists: number;
  minutes: number;
  yellows: number;
  reds: number;
  ratingSum: number;
  ratingCount: number;
};

export function createPlayerState(): PlayerState {
  return {
    fitness: 100,
    form: 6.5,
    injuredUntilRound: null,
    suspendedUntilRound: null,
    seasonYellows: 0,
    apps: 0,
    goals: 0,
    assists: 0,
    minutes: 0,
    yellows: 0,
    reds: 0,
    ratingSum: 0,
    ratingCount: 0,
  };
}

export type SeasonWorld = {
  clubIds: number[];
  clubNames: Map<number, string>;
  squads: Map<number, EnginePlayer[]>;
  states: Map<number, PlayerState>;
  formations: Map<number, FormationName>;
};

/** Builds the starting state for a season from squad data. */
export function createWorld(
  squads: Map<number, EnginePlayer[]>,
  clubNames: Map<number, string>,
): SeasonWorld {
  const states = new Map<number, PlayerState>();
  const formations = new Map<number, FormationName>();

  for (const [clubId, players] of squads) {
    for (const p of players) states.set(p.id, createPlayerState());
    formations.set(clubId, chooseFormation(players));
  }

  return { clubIds: [...squads.keys()], clubNames, squads, states, formations };
}

/** A player carrying their current condition, as the engine expects them. */
function withState(player: EnginePlayer, state: PlayerState): EnginePlayer {
  return { ...player, fitness: state.fitness, form: state.form };
}

function isAvailable(state: PlayerState, round: number): boolean {
  if (state.injuredUntilRound !== null && state.injuredUntilRound >= round) return false;
  if (state.suspendedUntilRound !== null && state.suspendedUntilRound >= round) return false;
  return true;
}

/** Squad members eligible for selection this round, with current condition. */
export function availableSquad(
  world: SeasonWorld,
  clubId: number,
  round: number,
): EnginePlayer[] {
  const squad = world.squads.get(clubId) ?? [];
  return squad
    .filter((p) => isAvailable(world.states.get(p.id)!, round))
    .map((p) => withState(p, world.states.get(p.id)!));
}

function toLineupPlayer(player: EnginePlayer, slot: Slot): LineupPlayer {
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

/**
 * Assembles a side from an explicit lineup, or picks one automatically.
 * The manager's own team passes a chosen lineup; the other nineteen do not.
 */
export function buildSide(
  world: SeasonWorld,
  clubId: number,
  round: number,
  isHome: boolean,
  options: {
    tactics?: TeamTactics;
    lineup?: { playerId: number; slot: Slot }[];
    benchIds?: number[];
    opponentClubId?: number;
    isUser?: boolean;
  } = {},
): MatchSide {
  const available = availableSquad(world, clubId, round);
  const byId = new Map(available.map((p) => [p.id, p]));

  const opponentPlayers = options.opponentClubId
    ? availableSquad(world, options.opponentClubId, round)
    : [];

  const tactics =
    options.tactics ??
    chooseTactics(available, opponentPlayers, isHome, world.formations.get(clubId));

  let lineup = options.lineup;
  let benchIds = options.benchIds;

  // Fall back to an automatic selection if none was supplied, or if the one
  // supplied is no longer legal because someone is injured or suspended.
  const supplied = lineup?.filter((entry) => byId.has(entry.playerId)) ?? [];
  if (!lineup || supplied.length < 11) {
    const picked = selectLineup(available, tactics.formation);
    lineup = picked.lineup;
    benchIds = picked.benchIds;
  } else {
    lineup = supplied;
  }

  const onPitch = lineup
    .map((entry) => {
      const player = byId.get(entry.playerId);
      return player ? toLineupPlayer(player, entry.slot) : null;
    })
    .filter((lp): lp is LineupPlayer => lp !== null);

  const startingIds = new Set(onPitch.map((lp) => lp.player.id));
  const benchSource =
    benchIds?.filter((id) => byId.has(id) && !startingIds.has(id)) ??
    available.filter((p) => !startingIds.has(p.id)).map((p) => p.id);

  const bench = benchSource
    .slice(0, 9)
    .map((id) => {
      const player = byId.get(id)!;
      return toLineupPlayer(player, player.isGk ? "GK" : "CM");
    });

  return {
    clubId,
    clubName: world.clubNames.get(clubId) ?? `Club ${clubId}`,
    tactics,
    onPitch,
    bench,
    subsUsed: 0,
    isHome,
    isUser: options.isUser ?? false,
  };
}

/** Simulates one fixture to full time with AI managers on both sides. */
export function simulateFixture(
  world: SeasonWorld,
  fixture: ScheduledFixture,
  seed: number,
): MatchResult {
  const fixtureId = `r${fixture.round}-${fixture.homeClubId}-${fixture.awayClubId}`;

  const home = buildSide(world, fixture.homeClubId, fixture.round, true, {
    opponentClubId: fixture.awayClubId,
  });
  const away = buildSide(world, fixture.awayClubId, fixture.round, false, {
    opponentClubId: fixture.homeClubId,
  });

  const state = createMatchState(fixtureId, seed, home, away);
  const events = simulateToEnd(state, aiMinuteHook);
  return buildMatchResult(state, events);
}

/**
 * Folds a finished match back into career state: appearances, goals, cards,
 * suspensions, injuries and the fitness each player finished on.
 */
export function applyResult(world: SeasonWorld, result: MatchResult, round: number): void {
  for (const p of result.players) {
    const state = world.states.get(p.playerId);
    if (!state) continue;

    state.apps++;
    state.minutes += p.minutesPlayed;
    state.goals += p.goals;
    state.assists += p.assists;
    state.yellows += p.yellowCards;
    state.reds += p.redCards;
    state.ratingSum += p.rating;
    state.ratingCount++;
    state.form = updateForm(state.form, p.rating);
    state.fitness = p.endFitness;

    if (p.redCards > 0) {
      state.suspendedUntilRound = round + DISCIPLINE.redCardBanRounds;
    } else {
      state.seasonYellows += p.yellowCards;
      // Yellow-card bans trigger on each multiple of the threshold.
      if (
        p.yellowCards > 0 &&
        state.seasonYellows % DISCIPLINE.yellowsForBan === 0
      ) {
        state.suspendedUntilRound = round + 1;
      }
    }

    if (p.injury && p.injury.outRounds > 0) {
      state.injuredUntilRound = round + p.injury.outRounds;
    }
  }
}

/** Applies a week of recovery to everyone who did not play. */
export function advanceWeek(world: SeasonWorld, playedIds: Set<number>): void {
  for (const [playerId, state] of world.states) {
    state.fitness = recoverFitness(state.fitness, playedIds.has(playerId));
  }
}

export type TableRow = {
  clubId: number;
  clubName: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
};

/** Builds the league table from results, ordered the way football orders it. */
export function buildTable(
  world: SeasonWorld,
  results: MatchResult[],
): TableRow[] {
  const rows = new Map<number, TableRow>();
  for (const clubId of world.clubIds) {
    rows.set(clubId, {
      clubId,
      clubName: world.clubNames.get(clubId) ?? `Club ${clubId}`,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      points: 0,
    });
  }

  for (const r of results) {
    const home = rows.get(r.homeClubId);
    const away = rows.get(r.awayClubId);
    if (!home || !away) continue;

    home.played++;
    away.played++;
    home.goalsFor += r.homeGoals;
    home.goalsAgainst += r.awayGoals;
    away.goalsFor += r.awayGoals;
    away.goalsAgainst += r.homeGoals;

    if (r.homeGoals > r.awayGoals) {
      home.won++;
      away.lost++;
      home.points += 3;
    } else if (r.homeGoals < r.awayGoals) {
      away.won++;
      home.lost++;
      away.points += 3;
    } else {
      home.drawn++;
      away.drawn++;
      home.points++;
      away.points++;
    }
  }

  return [...rows.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.goalsFor - b.goalsAgainst - (a.goalsFor - a.goalsAgainst) ||
      b.goalsFor - a.goalsFor ||
      a.clubName.localeCompare(b.clubName),
  );
}

export type SeasonOutcome = {
  table: TableRow[];
  results: MatchResult[];
  fixtures: ScheduledFixture[];
};

/** Plays a full season and returns the table and every result. */
export function simulateSeason(world: SeasonWorld, rng: RngState, seedBase = 0): SeasonOutcome {
  const fixtures = generateSchedule(world.clubIds, rng);
  const results: MatchResult[] = [];

  for (let round = 1; round <= ROUNDS_IN_SEASON; round++) {
    const playedIds = new Set<number>();

    for (const fixture of fixtures.filter((f) => f.round === round)) {
      const seed = hash32(
        `${seedBase}-${fixture.round}-${fixture.homeClubId}-${fixture.awayClubId}`,
      );
      const result = simulateFixture(world, fixture, seed);
      applyResult(world, result, round);
      results.push(result);
      for (const p of result.players) playedIds.add(p.playerId);
    }

    advanceWeek(world, playedIds);
  }

  return { table: buildTable(world, results), results, fixtures };
}
