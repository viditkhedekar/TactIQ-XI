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

import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
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
  recoverFitness,
  selectLineup,
  simulateSegment,
  simulateToEnd,
  updateForm,
  type EnginePlayer,
  type Intervention,
  type LineupPlayer,
  type MatchEvent,
  type MatchResult,
  type MatchSide,
  type MatchState,
  type SegmentBoundary,
  type Slot,
  type TeamTactics,
} from "@/engine";
import { toBench, toEnginePlayer, toLineup, toTeamTactics } from "./engineAdapter";
import { loadSquads } from "./careerService";
import { computeWeeklyTraining, loadTrainingPlan, saveTrainingReport } from "./trainingService";
import { processTransferRound } from "./transferService";

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
): Promise<Map<number, SquadEntry[]>> {
  const squads = await loadSquads(careerId, clubIds);
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
  await db.insert(matchEvents).values(
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
    await tx.insert(matchEvents).values(
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
    );
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
      await tx.insert(matchEvents).values(
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
      );
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

  for (const p of result.players) {
    const suspendedUntil =
      p.redCards > 0 ? round + DISCIPLINE.redCardBanRounds : null;

    await tx
      .update(careerPlayerState)
      .set({
        fitness: p.endFitness,
        form: updateForm(formById.get(p.playerId) ?? 6.5, p.rating),
        apps: sql`${careerPlayerState.apps} + 1`,
        minutes: sql`${careerPlayerState.minutes} + ${p.minutesPlayed}`,
        goals: sql`${careerPlayerState.goals} + ${p.goals}`,
        assists: sql`${careerPlayerState.assists} + ${p.assists}`,
        yellows: sql`${careerPlayerState.yellows} + ${p.yellowCards}`,
        reds: sql`${careerPlayerState.reds} + ${p.redCards}`,
        seasonYellows: sql`${careerPlayerState.seasonYellows} + ${p.yellowCards}`,
        ratingSum: sql`${careerPlayerState.ratingSum} + ${p.rating}`,
        ratingCount: sql`${careerPlayerState.ratingCount} + 1`,
        ...(suspendedUntil !== null ? { suspendedUntilRound: suspendedUntil } : {}),
        ...(p.injury
          ? { injuredUntilRound: round + p.injury.outRounds, injuryType: p.injury.severity }
          : {}),
      })
      .where(
        and(
          eq(careerPlayerState.careerId, careerId),
          eq(careerPlayerState.playerId, p.playerId),
        ),
      );
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

export type FinishResult = {
  userResult: { homeGoals: number; awayGoals: number };
  otherResults: { fixtureId: string; homeClubId: number; awayClubId: number; homeGoals: number; awayGoals: number }[];
  nextRound: number;
  seasonComplete: boolean;
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

  // The other nine fixtures of the round.
  const otherFixtures = await db
    .select()
    .from(fixtures)
    .where(
      and(
        eq(fixtures.careerId, careerId),
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
    await persistEvents(fixture.id, notable);
  }

  const playedIds = new Set(
    [...userResult.players, ...otherResults.flatMap((r) => r.players)].map((p) => p.playerId),
  );

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

    for (const row of states) {
      const training = week.byPlayer.get(row.playerId);
      const recovered = Math.max(
        0,
        recoverFitness(row.fitness, playedIds.has(row.playerId)) - (training?.fitnessCost ?? 0),
      );

      const unchanged = Math.abs(recovered - row.fitness) < 0.01;
      if (unchanged && !training) continue;

      await tx
        .update(careerPlayerState)
        .set({
          fitness: recovered,
          ...(training
            ? {
                attributeDeltas: training.attributeDeltas,
                ...(training.injuryOutRounds !== null
                  ? {
                      injuredUntilRound: round + training.injuryOutRounds,
                      injuryType: "training",
                    }
                  : {}),
              }
            : {}),
        })
        .where(
          and(
            eq(careerPlayerState.careerId, careerId),
            eq(careerPlayerState.playerId, row.playerId),
          ),
        );
    }

    // The market moves on the same tick, so bids put in this round get their
    // answer as the manager clicks through to the next one.
    await processTransferRound(tx, careerId, career.clubId, round + 1);

    await tx.delete(liveMatchState).where(eq(liveMatchState.fixtureId, live.fixtureId));
    await tx
      .update(careers)
      .set({ currentRound: round + 1, phase: "idle", updatedAt: new Date() })
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
    seasonComplete: round + 1 > 38,
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
