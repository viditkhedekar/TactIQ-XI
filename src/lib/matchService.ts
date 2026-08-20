/**
 * Running a matchday.
 *
 * This is where the engine's segment model meets persistence. The interesting
 * problem it solves: the manager watches a ticker that lags behind what the
 * server has already simulated, and may pause at any minute to make a change.
 *
 * The answer is to keep two copies of the match state, the current one and the
 * one from the start of the segment in progress. When a change arrives for
 * minute M, the server rewinds to the segment start, replays to M (which
 * regenerates exactly the events the manager already watched, because the RNG
 * state travels with the state), applies the change, and carries on. Nothing
 * the manager has seen is ever contradicted.
 */

import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  careerPlayerState,
  careerTactics,
  careers,
  clubs,
  fixtures,
  liveMatchState,
  matchEvents,
  type FixtureRow,
} from "@/db/schema";
import {
  DISCIPLINE,
  aiMinuteHook,
  analyseMatch,
  applyIntervention,
  buildMatchResult,
  chooseFormation,
  chooseTactics,
  createMatchState,
  createRng,
  hash32,
  penaltyShootout,
  recoverFitness,
  CUP,
  squadStrength,
  ROUNDS_IN_SEASON,
  selectLineup,
  simulateSegment,
  simulateToEnd,
  updateForm,
  type EnginePlayer,
  type Intervention,
  type LineupPlayer,
  type MatchAnalysis,
  type MatchEvent,
  type MatchResult,
  type MatchSide,
  type MatchState,
  type SegmentBoundary,
  type Slot,
  type TeamTactics,
} from "@/engine";
import { toBench, toEnginePlayer, toLineup, toTeamTactics } from "./engineAdapter";
import { ensureCareerExtras, loadSquads } from "./careerService";
import { computeWeeklyTraining, loadTrainingPlan, saveTrainingReport } from "./trainingService";
import { processTransferRound } from "./transferService";
import { ensureCupRound, recordCupHonours } from "./cupService";
import { updateBoardConfidence } from "./boardService";

/* --------------------------------------------------------------- assembling */

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

type SquadEntry = {
  player: EnginePlayer;
  injuredUntilRound: number | null;
  suspendedUntilRound: number | null;
};

function availableFor(squad: SquadEntry[], round: number): EnginePlayer[] {
  return squad
    .filter(
      (e) =>
        !(e.injuredUntilRound !== null && e.injuredUntilRound >= round) &&
        !(e.suspendedUntilRound !== null && e.suspendedUntilRound >= round),
    )
    .map((e) => e.player);
}

/**
 * Builds a side. A supplied team sheet is used when it is still legal; if a
 * named player has since been injured or suspended the whole selection falls
 * back to an automatic one rather than taking the field with ten men.
 */
function buildSide(
  squad: SquadEntry[],
  opponentSquad: SquadEntry[],
  round: number,
  clubId: number,
  clubName: string,
  isHome: boolean,
  options: {
    tactics?: TeamTactics;
    lineup?: { playerId: number; slot: Slot }[];
    bench?: number[];
    isUser?: boolean;
  } = {},
): MatchSide {
  const available = availableFor(squad, round);
  const byId = new Map(available.map((p) => [p.id, p]));

  const tactics =
    options.tactics ??
    chooseTactics(available, availableFor(opponentSquad, round), isHome, chooseFormation(available));

  let lineup = options.lineup?.filter((e) => byId.has(e.playerId)) ?? [];
  let benchIds = options.bench?.filter((id) => byId.has(id)) ?? [];

  if (lineup.length < 11) {
    const picked = selectLineup(available, tactics.formation);
    lineup = picked.lineup;
    benchIds = picked.benchIds;
  }

  const onPitch = lineup
    .map((e) => {
      const player = byId.get(e.playerId);
      return player ? toLineupPlayer(player, e.slot) : null;
    })
    .filter((lp): lp is LineupPlayer => lp !== null);

  const starterIds = new Set(onPitch.map((lp) => lp.player.id));
  const benchSource = benchIds.filter((id) => !starterIds.has(id));

  // Top the bench up if the saved one is short, so substitutions stay possible.
  if (benchSource.length < 7) {
    for (const p of available) {
      if (benchSource.length >= 9) break;
      if (!starterIds.has(p.id) && !benchSource.includes(p.id)) benchSource.push(p.id);
    }
  }

  const bench = benchSource.slice(0, 9).map((id) => {
    const player = byId.get(id)!;
    return toLineupPlayer(player, player.isGk ? "GK" : "CM");
  });

  return {
    clubId,
    clubName,
    tactics,
    onPitch,
    bench,
    subsUsed: 0,
    isHome,
    isUser: options.isUser ?? false,
  };
}

/** Loads every squad in the league as engine players with current condition. */
async function loadEngineSquads(
  careerId: string,
  clubIds: number[],
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db = db,
): Promise<Map<number, SquadEntry[]>> {
  const squads = await loadSquads(careerId, clubIds, tx);
  const out = new Map<number, SquadEntry[]>();

  for (const [clubId, members] of squads) {
    out.set(
      clubId,
      members.map((m) => ({
        player: toEnginePlayer(m.player, m.state),
        injuredUntilRound: m.state.injuredUntilRound,
        suspendedUntilRound: m.state.suspendedUntilRound,
      })),
    );
  }

  return out;
}

/* --------------------------------------------------------- starting a match */

export type StartMatchResult = {
  fixture: FixtureRow;
  state: MatchState;
};

/**
 * Opens the manager's fixture for the current round and stores the starting
 * match state. Returns the existing live match if one is already under way, so
 * a refreshed browser rejoins rather than restarting the game.
 */
export async function startMatchday(careerId: string): Promise<StartMatchResult> {
  const [career] = await db.select().from(careers).where(eq(careers.id, careerId)).limit(1);
  if (!career) throw new Error("Career not found");

  const round = career.currentRound;
  if (round > 38) throw new Error("The season is over");

  const [fixture] = await db
    .select()
    .from(fixtures)
    .where(
      and(
        eq(fixtures.careerId, careerId),
        eq(fixtures.round, round),
        sql`(${fixtures.homeClubId} = ${career.clubId} OR ${fixtures.awayClubId} = ${career.clubId})`,
      ),
    )
    .limit(1);

  if (!fixture) throw new Error("No fixture for this round");

  const existing = await loadLiveState(fixture.id);
  if (existing) return { fixture, state: existing.state };

  const allClubs = await db.select().from(clubs);
  const clubName = new Map(allClubs.map((c) => [c.id, c.name]));
  const squads = await loadEngineSquads(careerId, [fixture.homeClubId, fixture.awayClubId]);

  const [tacticsRow] = await db
    .select()
    .from(careerTactics)
    .where(eq(careerTactics.careerId, careerId))
    .limit(1);

  const userIsHome = fixture.homeClubId === career.clubId;
  const homeSquad = squads.get(fixture.homeClubId) ?? [];
  const awaySquad = squads.get(fixture.awayClubId) ?? [];

  const userOptions = tacticsRow
    ? {
        tactics: toTeamTactics(tacticsRow),
        lineup: toLineup(tacticsRow),
        bench: toBench(tacticsRow),
        isUser: true,
      }
    : { isUser: true };

  const home = buildSide(
    homeSquad,
    awaySquad,
    round,
    fixture.homeClubId,
    clubName.get(fixture.homeClubId) ?? "Home",
    true,
    userIsHome ? userOptions : {},
  );
  const away = buildSide(
    awaySquad,
    homeSquad,
    round,
    fixture.awayClubId,
    clubName.get(fixture.awayClubId) ?? "Away",
    false,
    userIsHome ? {} : userOptions,
  );

  const state = createMatchState(fixture.id, fixture.seed, home, away);

  await db.transaction(async (tx) => {
    await tx.insert(liveMatchState).values({
      fixtureId: fixture.id,
      careerId,
      currentMinute: 0,
      stateJson: state,
      segmentStartJson: state,
      segmentStartSeq: 0,
    });
    await tx.update(fixtures).set({ status: "in_progress" }).where(eq(fixtures.id, fixture.id));
    await tx.update(careers).set({ phase: "matchday" }).where(eq(careers.id, careerId));
  });

  return { fixture, state };
}

async function loadLiveState(
  fixtureId: string,
): Promise<{ state: MatchState; segmentStart: MatchState; segmentStartSeq: number } | null> {
  const [row] = await db
    .select()
    .from(liveMatchState)
    .where(eq(liveMatchState.fixtureId, fixtureId))
    .limit(1);

  if (!row) return null;

  return {
    state: row.stateJson as MatchState,
    segmentStart: row.segmentStartJson as MatchState,
    segmentStartSeq: row.segmentStartSeq,
  };
}

/** Confirms the live match belongs to this career before touching it. */
async function requireLiveMatch(careerId: string) {
  const [row] = await db
    .select()
    .from(liveMatchState)
    .where(and(eq(liveMatchState.careerId, careerId)))
    .limit(1);

  if (!row) throw new Error("No match is in progress");

  return {
    fixtureId: row.fixtureId,
    state: row.stateJson as MatchState,
    segmentStart: row.segmentStartJson as MatchState,
    segmentStartSeq: row.segmentStartSeq,
  };
}

async function persistEvents(fixtureId: string, events: MatchEvent[]): Promise<void> {
  if (events.length === 0) return;
  await db
    .insert(matchEvents)
    .values(
      events.map((e) => ({
        fixtureId,
        seq: e.seq,
        minute: e.minute,
        addedTime: e.addedTime,
        type: e.type,
        clubId: e.clubId,
        playerId: e.playerId,
        secondPlayerId: e.secondPlayerId,
        commentary: e.commentary,
        data: e.data,
      })),
    )
    // The simulation is deterministic, so a retried request produces the exact
    // same events for the same (fixture, seq) pair. Skipping the duplicate
    // rather than erroring is what makes a raced or retried request harmless.
    .onConflictDoNothing({ target: [matchEvents.fixtureId, matchEvents.seq] });
}

/** Same as persistEvents, but for several fixtures in one round trip. */
async function persistEventsForFixtures(
  batches: { fixtureId: string; events: MatchEvent[] }[],
): Promise<void> {
  const rows = batches.flatMap(({ fixtureId, events }) =>
    events.map((e) => ({
      fixtureId,
      seq: e.seq,
      minute: e.minute,
      addedTime: e.addedTime,
      type: e.type,
      clubId: e.clubId,
      playerId: e.playerId,
      secondPlayerId: e.secondPlayerId,
      commentary: e.commentary,
      data: e.data,
    })),
  );
  if (rows.length === 0) return;
  await db
    .insert(matchEvents)
    .values(rows)
    .onConflictDoNothing({ target: [matchEvents.fixtureId, matchEvents.seq] });
}

export type AdvanceResult = {
  events: MatchEvent[];
  minute: number;
  boundary: SegmentBoundary;
  homeGoals: number;
  awayGoals: number;
  finished: boolean;
};

/**
 * Simulates the next segment of the live match.
 *
 * `revealedMinute` is how far the manager's ticker has actually got to. The
 * browser runs behind the server on purpose, requesting the next segment
 * before it has finished playing the current one so the commentary never
 * stalls on the network. That means the rewind point cannot simply advance to
 * the head of the simulation: if it did, a manager pausing at 13' while the
 * server had already snapshotted 15' could not have their substitution applied
 * at the minute they were looking at. The snapshot only moves forward once the
 * manager has caught up to it.
 */
export async function advanceMatch(
  careerId: string,
  revealedMinute = Number.POSITIVE_INFINITY,
): Promise<AdvanceResult> {
  const live = await requireLiveMatch(careerId);
  if (live.state.finished) {
    return {
      events: [],
      minute: live.state.minute,
      boundary: "fulltime",
      homeGoals: live.state.homeGoals,
      awayGoals: live.state.awayGoals,
      finished: true,
    };
  }

  // Move the rewind point up to here only if the manager has already watched
  // this far; otherwise keep the older snapshot, which is still behind them.
  const canAdvanceSnapshot = revealedMinute >= live.state.minute;
  const segmentStart: MatchState = canAdvanceSnapshot
    ? JSON.parse(JSON.stringify(live.state))
    : live.segmentStart;
  const segmentStartSeq = canAdvanceSnapshot ? live.state.nextSeq : live.segmentStartSeq;

  const { state, events, boundary } = simulateSegment(live.state, { onMinute: aiMinuteHook });

  await db.transaction(async (tx) => {
    await tx
      .insert(matchEvents)
      .values(
        events.map((e) => ({
          fixtureId: live.fixtureId,
          seq: e.seq,
          minute: e.minute,
          addedTime: e.addedTime,
          type: e.type,
          clubId: e.clubId,
          playerId: e.playerId,
          secondPlayerId: e.secondPlayerId,
          commentary: e.commentary,
          data: e.data,
        })),
      )
      .onConflictDoNothing({ target: [matchEvents.fixtureId, matchEvents.seq] });
    await tx
      .update(liveMatchState)
      .set({
        stateJson: state,
        segmentStartJson: segmentStart,
        segmentStartSeq,
        currentMinute: state.minute,
        updatedAt: new Date(),
      })
      .where(eq(liveMatchState.fixtureId, live.fixtureId));
  });

  return {
    events,
    minute: state.minute,
    boundary,
    homeGoals: state.homeGoals,
    awayGoals: state.awayGoals,
    finished: state.finished,
  };
}

export type InterveneResult = AdvanceResult & {
  subsApplied: number;
  tacticsChanged: boolean;
};

/**
 * Applies the manager's changes at the minute they paused on.
 *
 * The rewind is the point: the server may have simulated past that minute, so
 * it goes back to the start of the segment, replays up to the pause (producing
 * the identical events, since the RNG state is part of the state it replayed
 * from), then applies the change and continues on a newly diverged stream.
 */
export async function interveneInMatch(
  careerId: string,
  atMinute: number,
  intervention: Intervention,
): Promise<InterveneResult> {
  const live = await requireLiveMatch(careerId);
  if (live.state.finished) throw new Error("The match has finished");

  const [career] = await db.select().from(careers).where(eq(careers.id, careerId)).limit(1);
  const userIsHome = live.state.home.clubId === career.clubId;

  // Rewind to the start of the segment and replay to the pause minute. The
  // snapshot is never allowed past what the manager has watched, so this only
  // clamps in the edge case of a request arriving with a stale minute.
  const rewound: MatchState = JSON.parse(JSON.stringify(live.segmentStart));
  const effectiveMinute = Math.max(atMinute, rewound.minute);
  const replayed: MatchEvent[] = [];

  let guard = 0;
  while (rewound.minute < effectiveMinute && !rewound.finished && guard++ < 200) {
    const { events } = simulateSegment(rewound, {
      onMinute: aiMinuteHook,
      maxMinutes: effectiveMinute - rewound.minute,
    });
    replayed.push(...events);
  }

  // Discard anything the manager had not yet seen, then re-record the replay.
  await db
    .delete(matchEvents)
    .where(
      and(
        eq(matchEvents.fixtureId, live.fixtureId),
        sql`${matchEvents.seq} >= ${live.segmentStartSeq}`,
      ),
    );
  await persistEvents(live.fixtureId, replayed);

  const changeEvents: MatchEvent[] = [];
  const applied = applyIntervention(rewound, userIsHome, intervention, changeEvents);
  await persistEvents(live.fixtureId, changeEvents);

  // Carry on from the pause with the change in place.
  const segmentStart: MatchState = JSON.parse(JSON.stringify(rewound));
  const segmentStartSeq = rewound.nextSeq;
  const { state, events, boundary } = simulateSegment(rewound, { onMinute: aiMinuteHook });

  await db.transaction(async (tx) => {
    if (events.length > 0) {
      await tx
        .insert(matchEvents)
        .values(
          events.map((e) => ({
            fixtureId: live.fixtureId,
            seq: e.seq,
            minute: e.minute,
            addedTime: e.addedTime,
            type: e.type,
            clubId: e.clubId,
            playerId: e.playerId,
            secondPlayerId: e.secondPlayerId,
            commentary: e.commentary,
            data: e.data,
          })),
        )
        .onConflictDoNothing({ target: [matchEvents.fixtureId, matchEvents.seq] });
    }
    await tx
      .update(liveMatchState)
      .set({
        stateJson: state,
        segmentStartJson: segmentStart,
        segmentStartSeq,
        currentMinute: state.minute,
        updatedAt: new Date(),
      })
      .where(eq(liveMatchState.fixtureId, live.fixtureId));
  });

  return {
    events: [...changeEvents, ...events],
    minute: state.minute,
    boundary,
    homeGoals: state.homeGoals,
    awayGoals: state.awayGoals,
    finished: state.finished,
    subsApplied: applied.subsApplied,
    tacticsChanged: applied.tacticsChanged,
  };
}

/* ------------------------------------------------------------- finishing up */

/** Folds one finished match into career state. */
async function applyMatchResult(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  careerId: string,
  result: MatchResult,
  round: number,
): Promise<void> {
  // Current form is read first so the rolling average can be computed by the
  // engine's own function rather than duplicated as SQL that could drift.
  const existing = await tx
    .select({ playerId: careerPlayerState.playerId, form: careerPlayerState.form })
    .from(careerPlayerState)
    .where(
      and(
        eq(careerPlayerState.careerId, careerId),
        inArray(
          careerPlayerState.playerId,
          result.players.map((p) => p.playerId),
        ),
      ),
    );
  const formById = new Map(existing.map((row) => [row.playerId, row.form]));

  if (result.players.length > 0) {
    // One statement for every player who featured, rather than one UPDATE per
    // player. A round is ten matches' worth of this sequentially, which was the
    // single largest cost in settling a round: each network round trip to a
    // managed Postgres runs 20-50ms even nearby, and that adds up across two
    // hundred-plus single-row statements.
    //
    // The ON CONFLICT DO UPDATE / excluded pattern is what makes a bulk insert
    // behave like a bulk update with per-row values. NULL is used as a "leave
    // this alone" sentinel for suspendedUntilRound/injuredUntilRound/injuryType,
    // which the original loop only ever touched conditionally: COALESCE falls
    // back to the existing column value exactly where the loop would have
    // omitted the field from its `set` entirely.
    await tx
      .insert(careerPlayerState)
      .values(
        result.players.map((p) => ({
          careerId,
          playerId: p.playerId,
          fitness: p.endFitness,
          form: updateForm(formById.get(p.playerId) ?? 6.5, p.rating),
          apps: 1,
          minutes: p.minutesPlayed,
          goals: p.goals,
          assists: p.assists,
          yellows: p.yellowCards,
          reds: p.redCards,
          seasonYellows: p.yellowCards,
          ratingSum: p.rating,
          ratingCount: 1,
          suspendedUntilRound: p.redCards > 0 ? round + DISCIPLINE.redCardBanRounds : null,
          injuredUntilRound: p.injury ? round + p.injury.outRounds : null,
          injuryType: p.injury ? p.injury.severity : null,
        })),
      )
      .onConflictDoUpdate({
        target: [careerPlayerState.careerId, careerPlayerState.playerId],
        set: {
          fitness: sql`excluded.fitness`,
          form: sql`excluded.form`,
          apps: sql`${careerPlayerState.apps} + excluded.apps`,
          minutes: sql`${careerPlayerState.minutes} + excluded.minutes`,
          goals: sql`${careerPlayerState.goals} + excluded.goals`,
          assists: sql`${careerPlayerState.assists} + excluded.assists`,
          yellows: sql`${careerPlayerState.yellows} + excluded.yellows`,
          reds: sql`${careerPlayerState.reds} + excluded.reds`,
          seasonYellows: sql`${careerPlayerState.seasonYellows} + excluded.season_yellows`,
          ratingSum: sql`${careerPlayerState.ratingSum} + excluded.rating_sum`,
          ratingCount: sql`${careerPlayerState.ratingCount} + excluded.rating_count`,
          suspendedUntilRound: sql`coalesce(excluded.suspended_until_round, ${careerPlayerState.suspendedUntilRound})`,
          injuredUntilRound: sql`coalesce(excluded.injured_until_round, ${careerPlayerState.injuredUntilRound})`,
          injuryType: sql`coalesce(excluded.injury_type, ${careerPlayerState.injuryType})`,
        },
      });
  }

  // Yellow-card bans, applied once the totals are up to date.
  await tx
    .update(careerPlayerState)
    .set({ suspendedUntilRound: round + 1 })
    .where(
      and(
        eq(careerPlayerState.careerId, careerId),
        inArray(
          careerPlayerState.playerId,
          result.players.filter((p) => p.yellowCards > 0).map((p) => p.playerId),
        ),
        sql`${careerPlayerState.seasonYellows} % ${DISCIPLINE.yellowsForBan} = 0`,
        sql`${careerPlayerState.seasonYellows} > 0`,
      ),
    );

  await tx
    .update(fixtures)
    .set({
      status: "finished",
      homeGoals: result.homeGoals,
      awayGoals: result.awayGoals,
      homeStats: result.homeStats,
      awayStats: result.awayStats,
    })
    .where(eq(fixtures.id, result.fixtureId));
}

/** A cup tie that has been played, including how it was settled. */
export type CupResult = {
  fixtureId: string;
  cupRound: number;
  homeClubId: number;
  awayClubId: number;
  homeGoals: number;
  awayGoals: number;
  winnerClubId: number;
  /** Set only when ninety minutes could not separate them. */
  shootout: { homeScore: number; awayScore: number } | null;
  result: MatchResult;
};

/**
 * Plays every cup tie due this round.
 *
 * Cup ties are simulated rather than watched: the manager's own tie is played
 * out by the engine exactly like the other nine league games are, and the
 * result is reported afterwards. A drawn tie goes to penalties immediately
 * rather than to extra time, which is a simplification, but the shootout is
 * where the drama is and extra time would need the engine to run past ninety.
 */
async function playCupRound(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  careerId: string,
  season: number,
  round: number,
  squads: Map<number, SquadEntry[]>,
  clubName: Map<number, string>,
): Promise<CupResult[]> {
  const ties = await ensureCupRound(tx, careerId, season, round);
  if (ties.length === 0) return [];

  // The draw can pair clubs whose squads were not loaded for the league round,
  // because the cup contains sides from outside the division.
  const needed = [...new Set(ties.flatMap((t) => [t.homeClubId, t.awayClubId]))].filter(
    (id) => !squads.has(id),
  );

  if (needed.length > 0) {
    const extra = await loadEngineSquads(careerId, needed, tx);
    for (const [clubId, squad] of extra) squads.set(clubId, squad);
  }

  const missingNames = needed.filter((id) => !clubName.has(id));
  if (missingNames.length > 0) {
    const rows = await tx
      .select({ id: clubs.id, name: clubs.name })
      .from(clubs)
      .where(inArray(clubs.id, missingNames));
    for (const row of rows) clubName.set(row.id, row.name);
  }

  const results: CupResult[] = [];

  for (const tie of ties) {
    const homeSquad = squads.get(tie.homeClubId) ?? [];
    const awaySquad = squads.get(tie.awayClubId) ?? [];
    if (homeSquad.length === 0 || awaySquad.length === 0) continue;

    const home = buildSide(
      homeSquad,
      awaySquad,
      round,
      tie.homeClubId,
      clubName.get(tie.homeClubId) ?? "Home",
      true,
    );
    const away = buildSide(
      awaySquad,
      homeSquad,
      round,
      tie.awayClubId,
      clubName.get(tie.awayClubId) ?? "Away",
      false,
    );

    const state = createMatchState(tie.id, tie.seed, home, away);
    const events = simulateToEnd(state, aiMinuteHook);
    const result = buildMatchResult(state, events);

    let winnerClubId: number;
    let shootout: { homeScore: number; awayScore: number } | null = null;

    if (result.homeGoals === result.awayGoals) {
      const penalties = penaltyShootout(
        createRng(hash32(`${careerId}-pens-${tie.id}`)),
        { clubId: tie.homeClubId, strength: squadStrength(homeSquad.map((m) => m.player)) },
        { clubId: tie.awayClubId, strength: squadStrength(awaySquad.map((m) => m.player)) },
      );
      winnerClubId = penalties.winnerClubId;
      shootout = { homeScore: penalties.homeScore, awayScore: penalties.awayScore };
    } else {
      winnerClubId = result.homeGoals > result.awayGoals ? tie.homeClubId : tie.awayClubId;
    }

    results.push({
      fixtureId: tie.id,
      cupRound: tie.cupRound ?? 0,
      homeClubId: tie.homeClubId,
      awayClubId: tie.awayClubId,
      homeGoals: result.homeGoals,
      awayGoals: result.awayGoals,
      winnerClubId,
      shootout,
      result,
    });
  }

  return results;
}

/** Writes cup results back, including the fitness and cards they cost. */
async function applyCupResults(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  careerId: string,
  results: CupResult[],
  round: number,
): Promise<void> {
  for (const cup of results) {
    await applyMatchResult(tx, careerId, cup.result, round);
    await tx
      .update(fixtures)
      .set({
        winnerClubId: cup.winnerClubId,
        penaltyShootout: cup.shootout,
      })
      .where(eq(fixtures.id, cup.fixtureId));
  }
}

export type FinishResult = {
  userResult: { homeGoals: number; awayGoals: number };
  otherResults: { fixtureId: string; homeClubId: number; awayClubId: number; homeGoals: number; awayGoals: number }[];
  nextRound: number;
  seasonComplete: boolean;
  /** Set when the board dismissed the manager on the back of this round. */
  sacked: boolean;
  /** Cup ties played this round, if it was a cup week. */
  cupResults: {
    cupRound: number;
    homeClubId: number;
    awayClubId: number;
    homeGoals: number;
    awayGoals: number;
    winnerClubId: number;
    shootout: { homeScore: number; awayScore: number } | null;
  }[];
  /** The fixture whose report the manager should be shown next. */
  reportFixtureId: string;
};

/**
 * Completes the round: finishes the manager's match, simulates the other nine,
 * applies a week of recovery to everyone, and moves the career on.
 */
export async function finishMatchday(careerId: string): Promise<FinishResult> {
  const live = await requireLiveMatch(careerId);
  const [career] = await db.select().from(careers).where(eq(careers.id, careerId)).limit(1);
  const round = career.currentRound;

  // Play out anything left of the manager's match.
  const state = live.state;
  const remaining = state.finished ? [] : simulateToEnd(state, aiMinuteHook);
  await persistEvents(live.fixtureId, remaining);

  const storedEvents = await db
    .select()
    .from(matchEvents)
    .where(eq(matchEvents.fixtureId, live.fixtureId))
    .orderBy(asc(matchEvents.seq));

  const userEvents: MatchEvent[] = storedEvents.map((row) => ({
    seq: row.seq,
    minute: row.minute,
    addedTime: row.addedTime,
    type: row.type as MatchEvent["type"],
    clubId: row.clubId,
    playerId: row.playerId,
    secondPlayerId: row.secondPlayerId,
    commentary: row.commentary,
    data: row.data as MatchEvent["data"],
  }));

  const userResult = buildMatchResult(state, userEvents);

  // Built here, while the finished match state is still in hand. The live state
  // is deleted at the end of this function, and rebuilding it later would mean
  // re-simulating the whole match.
  const report = analyseMatch(state, userEvents, career.clubId);

  // The other nine fixtures of the round. Season and competition both have to
  // be pinned: round numbers repeat every season, and a cup tie sits in the
  // same round as the league games. Without both filters this would pull in
  // fixtures from other seasons of the save and any cup tie scheduled this
  // week, and simulate them a second time as if they were league matches.
  const otherFixtures = await db
    .select()
    .from(fixtures)
    .where(
      and(
        eq(fixtures.careerId, careerId),
        eq(fixtures.season, career.season),
        eq(fixtures.competition, "league"),
        eq(fixtures.round, round),
        ne(fixtures.id, live.fixtureId),
      ),
    );

  const involvedClubs = [
    ...new Set(otherFixtures.flatMap((f) => [f.homeClubId, f.awayClubId])),
  ];
  const squads = await loadEngineSquads(careerId, involvedClubs);
  const allClubs = await db.select().from(clubs);
  const clubName = new Map(allClubs.map((c) => [c.id, c.name]));

  const otherResults: MatchResult[] = [];
  // Collected across all nine fixtures and inserted once below, rather than
  // one round trip per fixture: nobody is watching these, so there is no
  // reason to write them as they happen rather than all together at the end.
  const otherNotableEvents: { fixtureId: string; events: MatchEvent[] }[] = [];

  for (const fixture of otherFixtures) {
    const homeSquad = squads.get(fixture.homeClubId) ?? [];
    const awaySquad = squads.get(fixture.awayClubId) ?? [];

    const home = buildSide(
      homeSquad,
      awaySquad,
      round,
      fixture.homeClubId,
      clubName.get(fixture.homeClubId) ?? "Home",
      true,
    );
    const away = buildSide(
      awaySquad,
      homeSquad,
      round,
      fixture.awayClubId,
      clubName.get(fixture.awayClubId) ?? "Away",
      false,
    );

    const matchState = createMatchState(fixture.id, fixture.seed, home, away);
    const events = simulateToEnd(matchState, aiMinuteHook);
    otherResults.push(buildMatchResult(matchState, events));

    // Only the notable events are stored for matches nobody watched.
    const notable = events.filter((e) =>
      ["goal", "red", "penalty_missed", "fulltime"].includes(e.type),
    );
    otherNotableEvents.push({ fixtureId: fixture.id, events: notable });
  }
  await persistEventsForFixtures(otherNotableEvents);

  // Filled inside the transaction below, but declared here so the result this
  // function returns can report on the cup as well as the league.
  let cupResults: CupResult[] = [];
  let sacked = false;

  const playedIds = new Set(
    [...userResult.players, ...otherResults.flatMap((r) => r.players)].map((p) => p.playerId),
  );

  // Older saves have no budget rows, and without them the market would sit
  // silent for the rest of the career. Doing it here rather than only on the
  // transfers screen means a manager who never opens that screen still gets a
  // division that does its own business.
  await ensureCareerExtras(careerId);

  const plan = await loadTrainingPlan(careerId);

  await db.transaction(async (tx) => {
    await applyMatchResult(tx, careerId, userResult, round);
    for (const result of otherResults) await applyMatchResult(tx, careerId, result, round);

    // The manager's report, kept on the fixture so the screen can read it back
    // without the match state.
    await tx
      .update(fixtures)
      .set({ report })
      .where(eq(fixtures.id, live.fixtureId));

    // Training is worked out after the match results land, so a player injured
    // this afternoon is correctly left out of the week's work.
    const week = await computeWeeklyTraining(tx, careerId, career.clubId, round, plan);
    await saveTrainingReport(tx, careerId, round, plan, week);

    // A week of recovery. Players who did not feature recover more, and
    // whatever the week's training cost comes back off the top: the days
    // between matches are either rest or work, not both.
    const states = await tx
      .select()
      .from(careerPlayerState)
      .where(eq(careerPlayerState.careerId, careerId));

    // As with applyMatchResult above, this was a sequential UPDATE per row of
    // the whole league (roughly 550 players) and is now one bulk statement.
    // NULL is again the "leave alone" sentinel for attributeDeltas / injury
    // fields, which trainPlayer never itself produces as a real value.
    const recoveryUpdates = states
      .map((row) => {
        const training = week.byPlayer.get(row.playerId);
        const recovered = Math.max(
          0,
          recoverFitness(row.fitness, playedIds.has(row.playerId)) - (training?.fitnessCost ?? 0),
        );

        const unchanged = Math.abs(recovered - row.fitness) < 0.01;
        if (unchanged && !training) return null;

        return {
          careerId,
          playerId: row.playerId,
          fitness: recovered,
          attributeDeltas: training ? training.attributeDeltas : null,
          injuredUntilRound:
            training && training.injuryOutRounds !== null ? round + training.injuryOutRounds : null,
          injuryType: training && training.injuryOutRounds !== null ? "training" : null,
        };
      })
      .filter((row) => row !== null);

    if (recoveryUpdates.length > 0) {
      await tx
        .insert(careerPlayerState)
        .values(recoveryUpdates)
        .onConflictDoUpdate({
          target: [careerPlayerState.careerId, careerPlayerState.playerId],
          set: {
            fitness: sql`excluded.fitness`,
            attributeDeltas: sql`coalesce(excluded.attribute_deltas, ${careerPlayerState.attributeDeltas})`,
            injuredUntilRound: sql`coalesce(excluded.injured_until_round, ${careerPlayerState.injuredUntilRound})`,
            injuryType: sql`coalesce(excluded.injury_type, ${careerPlayerState.injuryType})`,
          },
        });
    }

    // The market moves on the same tick, so bids put in this round get their
    // answer as the manager clicks through to the next one.
    await processTransferRound(tx, careerId, career.clubId, round + 1);

    // Any cup tie due this week, played after the league game so the fitness it
    // costs lands on players who have already turned out on the Saturday.
    cupResults = await playCupRound(tx, careerId, career.season, round, squads, clubName);

    if (cupResults.length > 0) {
      await applyCupResults(tx, careerId, cupResults, round);
      // The final is the last tie of the last cup round, so the cabinet can be
      // written the moment it has been settled.
      if (cupResults[0].cupRound === CUP.rounds) {
        await recordCupHonours(tx, careerId, career.season, career.clubId);
      }
    }

    await tx.delete(liveMatchState).where(eq(liveMatchState.fixtureId, live.fixtureId));

    // The board watches every round, and can act on what it sees. Done last, so
    // it is judging the round that has just been fully settled.
    const [updated] = await tx.select().from(careers).where(eq(careers.id, careerId)).limit(1);
    const verdict = await updateBoardConfidence(tx, { ...updated, currentRound: round });
    sacked = verdict.sacked;

    const seasonComplete = round >= ROUNDS_IN_SEASON;

    await tx
      .update(careers)
      .set({
        currentRound: round + 1,
        // A season that has run its course waits on the review screen rather
        // than rolling straight into the next one: the manager should see where
        // he finished before being asked to do it again.
        phase: sacked ? "sacked" : seasonComplete ? "season_over" : "idle",
        updatedAt: new Date(),
      })
      .where(eq(careers.id, careerId));
  });

  return {
    userResult: { homeGoals: userResult.homeGoals, awayGoals: userResult.awayGoals },
    otherResults: otherResults.map((r) => ({
      fixtureId: r.fixtureId,
      homeClubId: r.homeClubId,
      awayClubId: r.awayClubId,
      homeGoals: r.homeGoals,
      awayGoals: r.awayGoals,
    })),
    nextRound: round + 1,
    seasonComplete: round >= ROUNDS_IN_SEASON,
    sacked,
    cupResults: cupResults.map((c) => ({
      cupRound: c.cupRound,
      homeClubId: c.homeClubId,
      awayClubId: c.awayClubId,
      homeGoals: c.homeGoals,
      awayGoals: c.awayGoals,
      winnerClubId: c.winnerClubId,
      shootout: c.shootout,
    })),
    reportFixtureId: live.fixtureId,
  };
}

/** Plays the manager's match straight through without the ticker. */
export async function quickSimMatchday(careerId: string): Promise<FinishResult> {
  await startMatchday(careerId);
  const live = await requireLiveMatch(careerId);

  if (!live.state.finished) {
    const events = simulateToEnd(live.state, aiMinuteHook);
    await persistEvents(live.fixtureId, events);
    await db
      .update(liveMatchState)
      .set({ stateJson: live.state, currentMinute: live.state.minute })
      .where(eq(liveMatchState.fixtureId, live.fixtureId));
  }

  return finishMatchday(careerId);
}

/**
 * The most recent match report, which is what the manager is sent to at full
 * time. Falls back to the latest one on record when no fixture is named, so a
 * refresh of the report screen still finds it.
 */
export async function loadMatchReport(
  careerId: string,
  clubId: number,
  fixtureId?: string,
): Promise<MatchAnalysis | null> {
  const rows = await db
    .select({ report: fixtures.report, round: fixtures.round, id: fixtures.id })
    .from(fixtures)
    .where(
      and(
        eq(fixtures.careerId, careerId),
        eq(fixtures.status, "finished"),
        sql`${fixtures.report} IS NOT NULL`,
        fixtureId
          ? eq(fixtures.id, fixtureId)
          : sql`(${fixtures.homeClubId} = ${clubId} OR ${fixtures.awayClubId} = ${clubId})`,
      ),
    )
    .orderBy(desc(fixtures.round))
    .limit(1);

  return (rows[0]?.report as MatchAnalysis | undefined) ?? null;
}

/** The events of a finished match, for the report screen. */
export async function loadMatchEvents(fixtureId: string): Promise<MatchEvent[]> {
  const rows = await db
    .select()
    .from(matchEvents)
    .where(eq(matchEvents.fixtureId, fixtureId))
    .orderBy(asc(matchEvents.seq));

  return rows.map((row) => ({
    seq: row.seq,
    minute: row.minute,
    addedTime: row.addedTime,
    type: row.type as MatchEvent["type"],
    clubId: row.clubId,
    playerId: row.playerId,
    secondPlayerId: row.secondPlayerId,
    commentary: row.commentary,
    data: row.data as MatchEvent["data"],
  }));
}
