/**
 * The match loop.
 *
 * A match advances a minute at a time. Each minute, each side may create a
 * moment (which becomes a chance, then a shot, then perhaps a goal), commit a
 * foul, or lose someone to injury, and everyone on the pitch gets a little
 * more tired. Team ratings are recomputed whenever something changes them.
 *
 * The loop is driven in segments rather than run to completion, because the
 * manager needs to be able to stop it: `simulateSegment` runs until something
 * worth pausing for happens and then hands control back. Because the RNG
 * state travels inside MatchState, a segment can be re-run from a saved state
 * and will reproduce exactly the same events, which is what makes mid-match
 * substitutions possible without rewriting history the player already saw.
 */

import { CHANCES, MATCH, SET_PIECES, SHOOTING } from "./constants";
import {
  isPenaltyFoul,
  pickAssister,
  pickChanceType,
  pickFouled,
  pickFouler,
  pickPenaltyTaker,
  pickShooter,
  resolveCard,
  resolveShot,
} from "./actions";
import {
  buildUpLine,
  foulLine,
  fullTimeLine,
  goalLine,
  halfTimeLine,
  injuryLine,
  joinPhrases,
  kickoffLine,
  penaltyAwardedLine,
  penaltyMissedLine,
  redLine,
  saveLine,
  shotBlockedLine,
  shotOffLine,
  subLine,
  tacticChangeLine,
  yellowLine,
} from "./commentary";
import {
  forcesSubstitution,
  injuryChancePerMinute,
  rollAddedTime,
  rollInjury,
} from "./fatigue";
import {
  applyCleanSheet,
  applyTeamDrift,
  creditAssist,
  creditGoal,
  creditGoalConceded,
  creditPenaltyMissed,
  creditRed,
  creditSave,
  creditShotOff,
  creditShotOnTarget,
  creditYellow,
  finalRating,
} from "./playerRating";
import { computeTeamRatings, type TeamRatings } from "./ratings";
import { chance, createRng } from "./rng";
import {
  applyTacticsChange,
  fatigueDrain,
  foulRate,
  momentRate,
  possessionShare,
  turnoverChance,
} from "./tactics";
import type {
  InjurySeverity,
  Intervention,
  LineupPlayer,
  MatchEvent,
  MatchResult,
  MatchSide,
  MatchState,
  MatchStats,
  PlayerMatchResult,
  SegmentBoundary,
  SegmentResult,
  Substitution,
} from "./types";

function emptyStats(): MatchStats {
  return {
    possession: 0,
    shots: 0,
    shotsOnTarget: 0,
    bigChances: 0,
    corners: 0,
    fouls: 0,
    yellowCards: 0,
    redCards: 0,
    xg: 0,
  };
}

export function createMatchState(
  fixtureId: string,
  seed: number,
  home: MatchSide,
  away: MatchSide,
): MatchState {
  return {
    fixtureId,
    minute: 0,
    addedTime: 0,
    half: 0,
    finished: false,
    rng: createRng(seed),
    home,
    away,
    homeGoals: 0,
    awayGoals: 0,
    homeStats: emptyStats(),
    awayStats: emptyStats(),
    nextSeq: 0,
  };
}

/** Per-minute context, recomputed whenever the lineups or instructions change. */
type MatchContext = {
  homeRatings: TeamRatings;
  awayRatings: TeamRatings;
  homePossession: number;
  homeMomentRate: number;
  awayMomentRate: number;
  homeFoulRate: number;
  awayFoulRate: number;
};

function averageAggression(side: MatchSide): number {
  const outfield = side.onPitch.filter((lp) => !lp.sentOff && !lp.player.isGk);
  if (outfield.length === 0) return 55;
  return outfield.reduce((sum, lp) => sum + lp.player.aggression, 0) / outfield.length;
}

function buildContext(state: MatchState): MatchContext {
  const homeRatings = computeTeamRatings(state.home);
  const awayRatings = computeTeamRatings(state.away);
  const homePossession = possessionShare(
    homeRatings.midfield,
    awayRatings.midfield,
    state.home.tactics,
    state.away.tactics,
  );

  return {
    homeRatings,
    awayRatings,
    homePossession,
    homeMomentRate: momentRate(
      homeRatings,
      awayRatings,
      state.home.tactics,
      state.away.tactics,
      true,
      homePossession,
    ),
    awayMomentRate: momentRate(
      awayRatings,
      homeRatings,
      state.away.tactics,
      state.home.tactics,
      false,
      1 - homePossession,
    ),
    homeFoulRate: foulRate(state.home.tactics, averageAggression(state.home)),
    awayFoulRate: foulRate(state.away.tactics, averageAggression(state.away)),
  };
}

type Emitter = (
  event: Omit<MatchEvent, "seq" | "minute" | "addedTime">,
) => MatchEvent;

function makeEmitter(state: MatchState, sink: MatchEvent[]): Emitter {
  return (partial) => {
    const event: MatchEvent = {
      seq: state.nextSeq++,
      minute: state.minute,
      addedTime: state.addedTime,
      ...partial,
    };
    sink.push(event);
    return event;
  };
}

function sideOf(state: MatchState, isHome: boolean): MatchSide {
  return isHome ? state.home : state.away;
}

function statsOf(state: MatchState, isHome: boolean): MatchStats {
  return isHome ? state.homeStats : state.awayStats;
}

function keeperOf(side: MatchSide): LineupPlayer | null {
  return side.onPitch.find((lp) => lp.player.isGk && !lp.sentOff) ?? null;
}

function addGoal(state: MatchState, isHome: boolean): void {
  if (isHome) state.homeGoals++;
  else state.awayGoals++;
}

/**
 * Runs one chance from build-up to outcome, recording the shot, the goal or
 * the save, and the commentary that describes it.
 */
function resolveChance(
  state: MatchState,
  ctx: MatchContext,
  isHome: boolean,
  emit: Emitter,
  forcedType?: "counter" | "penalty",
): { scored: boolean } {
  const rng = state.rng;
  const attacking = sideOf(state, isHome);
  const defending = sideOf(state, !isHome);
  const attackRatings = isHome ? ctx.homeRatings : ctx.awayRatings;
  const defendRatings = isHome ? ctx.awayRatings : ctx.homeRatings;
  const stats = statsOf(state, isHome);

  const type =
    forcedType ?? pickChanceType(rng, attacking.tactics, attackRatings, defendRatings);

  const shooter =
    type === "penalty" ? pickPenaltyTaker(attacking) : pickShooter(rng, attacking, type);
  if (!shooter) return { scored: false };

  const assister = pickAssister(rng, attacking, shooter, type);
  const keeper = keeperOf(defending);
  const names = {
    player: shooter.player.name,
    second: assister?.player.name,
    club: attacking.clubName,
    keeper: keeper?.player.name,
  };

  const { outcome, xg } = resolveShot(
    rng,
    shooter,
    type,
    defendRatings.defence,
    defendRatings.goalkeeping,
  );

  stats.shots++;
  stats.xg = Math.round((stats.xg + xg) * 100) / 100;
  if (xg >= 0.22) stats.bigChances++;

  const buildUp = buildUpLine(rng, type, names);

  if (outcome === "goal") {
    stats.shotsOnTarget++;
    addGoal(state, isHome);
    creditGoal(shooter);
    if (assister) creditAssist(assister);
    creditGoalConceded(defending.onPitch);

    emit({
      type: "goal",
      clubId: attacking.clubId,
      playerId: shooter.player.id,
      secondPlayerId: assister?.player.id ?? null,
      commentary: joinPhrases(buildUp, goalLine(rng, names, Boolean(assister))),
      data: {
        chanceType: type,
        xg,
        homeGoals: state.homeGoals,
        awayGoals: state.awayGoals,
      },
    });
    return { scored: true };
  }

  if (outcome === "save") {
    stats.shotsOnTarget++;
    creditShotOnTarget(shooter);
    if (keeper) creditSave(keeper);

    if (type === "penalty") {
      creditPenaltyMissed(shooter);
      emit({
        type: "penalty_missed",
        clubId: attacking.clubId,
        playerId: shooter.player.id,
        secondPlayerId: keeper?.player.id ?? null,
        commentary: penaltyMissedLine(rng, names),
        data: { chanceType: type, xg },
      });
      return { scored: false };
    }

    emit({
      type: "save",
      clubId: attacking.clubId,
      playerId: shooter.player.id,
      secondPlayerId: keeper?.player.id ?? null,
      commentary: joinPhrases(buildUp, saveLine(rng, names)),
      data: { chanceType: type, xg },
    });
    return { scored: false };
  }

  // Off target or blocked.
  creditShotOff(shooter);
  if (type === "penalty") {
    creditPenaltyMissed(shooter);
    emit({
      type: "penalty_missed",
      clubId: attacking.clubId,
      playerId: shooter.player.id,
      secondPlayerId: null,
      commentary: penaltyMissedLine(rng, names),
      data: { chanceType: type, xg },
    });
    return { scored: false };
  }

  const blocked = outcome === "blocked";
  if (chance(rng, SHOOTING.cornerFromShot)) stats.corners++;

  emit({
    type: blocked ? "shot_blocked" : "shot_off",
    clubId: attacking.clubId,
    playerId: shooter.player.id,
    secondPlayerId: assister?.player.id ?? null,
    commentary: joinPhrases(
      buildUp,
      blocked ? shotBlockedLine(rng, names) : shotOffLine(rng, names),
    ),
    data: { chanceType: type, xg },
  });
  return { scored: false };
}

/** Runs one foul, including the card and any penalty that follows. */
function resolveFoul(
  state: MatchState,
  ctx: MatchContext,
  isHome: boolean,
  emit: Emitter,
): { red: boolean; penaltyScored: boolean } {
  const rng = state.rng;
  const offending = sideOf(state, isHome);
  const victimSide = sideOf(state, !isHome);
  const stats = statsOf(state, isHome);

  const fouler = pickFouler(rng, offending);
  const fouled = pickFouled(rng, victimSide);
  if (!fouler) return { red: false, penaltyScored: false };

  stats.fouls++;
  const names = {
    player: fouler.player.name,
    second: fouled?.player.name,
    club: offending.clubName,
  };

  const card = resolveCard(rng);
  let red = false;

  if (card === "red") {
    fouler.sentOff = true;
    fouler.offAtMinute = state.minute;
    creditRed(fouler);
    stats.redCards++;
    red = true;
    emit({
      type: "red",
      clubId: offending.clubId,
      playerId: fouler.player.id,
      secondPlayerId: fouled?.player.id ?? null,
      commentary: redLine(rng, names, false),
      data: null,
    });
  } else if (card === "yellow") {
    fouler.yellowCards++;
    creditYellow(fouler);
    stats.yellowCards++;

    if (fouler.yellowCards >= 2) {
      fouler.sentOff = true;
      fouler.offAtMinute = state.minute;
      creditRed(fouler);
      stats.redCards++;
      red = true;
      emit({
        type: "red",
        clubId: offending.clubId,
        playerId: fouler.player.id,
        secondPlayerId: null,
        commentary: redLine(rng, names, true),
        data: null,
      });
    } else {
      emit({
        type: "yellow",
        clubId: offending.clubId,
        playerId: fouler.player.id,
        secondPlayerId: fouled?.player.id ?? null,
        commentary: yellowLine(rng, names),
        data: null,
      });
    }
  } else {
    emit({
      type: "foul",
      clubId: offending.clubId,
      playerId: fouler.player.id,
      secondPlayerId: fouled?.player.id ?? null,
      commentary: foulLine(rng, names),
      data: null,
    });
  }

  let penaltyScored = false;
  if (isPenaltyFoul(rng, SET_PIECES.penaltyFromFoul)) {
    emit({
      type: "penalty_awarded",
      clubId: victimSide.clubId,
      playerId: fouler.player.id,
      secondPlayerId: fouled?.player.id ?? null,
      commentary: penaltyAwardedLine(rng, {
        player: fouler.player.name,
        second: fouled?.player.name,
        club: victimSide.clubName,
      }),
      data: null,
    });
    penaltyScored = resolveChance(state, ctx, !isHome, emit, "penalty").scored;
  }

  return { red, penaltyScored };
}

/** Drains fitness for everyone on the pitch and rolls for injuries. */
function tickFitnessAndInjuries(
  state: MatchState,
  emit: Emitter,
): { injuryForcedSub: boolean } {
  let injuryForcedSub = false;

  for (const side of [state.home, state.away]) {
    for (const lp of side.onPitch) {
      if (lp.sentOff) continue;

      lp.minutesPlayed++;
      lp.fitness = Math.max(
        0,
        lp.fitness - fatigueDrain(lp.slot, lp.player.stamina, side.tactics),
      );

      if (lp.injured) continue;
      if (!chance(state.rng, injuryChancePerMinute(lp.player, lp.fitness))) continue;

      const { severity, outRounds } = rollInjury(state.rng);
      lp.injured = true;

      if (forcesSubstitution(severity)) {
        injuryForcedSub = true;
      } else {
        // A knock is played through, at a cost.
        lp.fitness = Math.max(0, lp.fitness - 6);
      }

      emit({
        type: "injury",
        clubId: side.clubId,
        playerId: lp.player.id,
        secondPlayerId: null,
        commentary: injuryLine(state.rng, severity, {
          player: lp.player.name,
          club: side.clubName,
        }),
        data: { severity, outRounds },
      });
    }
  }

  return { injuryForcedSub };
}

/**
 * Applies a substitution. Returns false when the change is not legal, so the
 * caller can reject a tampered request rather than corrupting the lineup.
 */
export function applySubstitution(
  state: MatchState,
  side: MatchSide,
  sub: Substitution,
  emit: Emitter | null,
): boolean {
  if (side.subsUsed >= MATCH.maxSubs) return false;

  const offIndex = side.onPitch.findIndex((lp) => lp.player.id === sub.off && !lp.sentOff);
  if (offIndex === -1) return false;

  const onIndex = side.bench.findIndex((lp) => lp.player.id === sub.on);
  if (onIndex === -1) return false;

  const off = side.onPitch[offIndex];
  const on = side.bench[onIndex];

  // A keeper may only be replaced by a keeper, and vice versa.
  if (off.player.isGk !== on.player.isGk) return false;

  off.offAtMinute = state.minute;
  on.slot = off.slot;
  on.onAtMinute = state.minute;
  on.minutesPlayed = 0;

  side.onPitch[offIndex] = on;
  side.bench.splice(onIndex, 1);
  side.bench.push(off);
  side.subsUsed++;

  if (emit) {
    emit({
      type: "sub",
      clubId: side.clubId,
      playerId: off.player.id,
      secondPlayerId: on.player.id,
      commentary: subLine(state.rng, {
        player: off.player.name,
        second: on.player.name,
        club: side.clubName,
      }),
      data: null,
    });
  }

  return true;
}

/**
 * Applies a manager's changes at a pause point. Invalid substitutions are
 * skipped rather than throwing, and the count of accepted changes is returned
 * so the caller can tell the manager what actually happened.
 */
export function applyIntervention(
  state: MatchState,
  isHome: boolean,
  intervention: Intervention,
  sink: MatchEvent[],
): { subsApplied: number; tacticsChanged: boolean } {
  const side = sideOf(state, isHome);
  const emit = makeEmitter(state, sink);
  let subsApplied = 0;

  for (const sub of intervention.subs ?? []) {
    if (applySubstitution(state, side, sub, emit)) subsApplied++;
  }

  let tacticsChanged = false;
  if (intervention.tactics) {
    const updated = applyTacticsChange(side.tactics, intervention.tactics);
    tacticsChanged = JSON.stringify(updated) !== JSON.stringify(side.tactics);
    if (tacticsChanged) {
      side.tactics = updated;
      emit({
        type: "tactic_change",
        clubId: side.clubId,
        playerId: null,
        secondPlayerId: null,
        commentary: tacticChangeLine(side.clubName),
        data: null,
      });
    }
  }

  return { subsApplied, tacticsChanged };
}

/**
 * Simulates forward until something worth pausing for, or until `maxMinutes`
 * of match time have passed. Returns the events generated in this segment.
 *
 * `onAiCheck` is called at each minute so an AI manager can make its own
 * substitutions; it is a callback rather than a direct import so the engine
 * has no opinion about who is managing which side.
 */
export function simulateSegment(
  state: MatchState,
  options: {
    maxMinutes?: number;
    /** Called each minute so AI managers can react. Return true if changed. */
    onMinute?: (state: MatchState, emit: Emitter) => boolean;
    /** Stop at goals and other drama. False runs straight through to full time. */
    stopAtEvents?: boolean;
  } = {},
): SegmentResult {
  const { maxMinutes = MATCH.segmentMinutes, onMinute, stopAtEvents = true } = options;
  const events: MatchEvent[] = [];
  const emit = makeEmitter(state, events);

  if (state.finished) {
    return { state, events, boundary: "fulltime" };
  }

  let ctx = buildContext(state);

  // Kickoff.
  if (state.half === 0) {
    state.half = 1;
    state.minute = 0;
    emit({
      type: "kickoff",
      clubId: null,
      playerId: null,
      secondPlayerId: null,
      commentary: kickoffLine(state.home.clubName, state.away.clubName),
      data: null,
    });
  }

  const startMinute = state.minute;
  let boundary: SegmentBoundary = "interval";

  while (state.minute < MATCH.minutes + state.addedTime) {
    // Half time.
    if (state.half === 1 && state.minute >= 45 + state.addedTime) {
      state.half = 2;
      state.minute = 45;
      state.addedTime = 0;
      emit({
        type: "halftime",
        clubId: null,
        playerId: null,
        secondPlayerId: null,
        commentary: halfTimeLine(
          state.home.clubName,
          state.homeGoals,
          state.away.clubName,
          state.awayGoals,
        ),
        data: { homeGoals: state.homeGoals, awayGoals: state.awayGoals },
      });
      if (stopAtEvents) return { state, events, boundary: "halftime" };
      ctx = buildContext(state);
      continue;
    }

    state.minute++;

    // Added time is decided as the half draws to a close.
    if (state.half === 1 && state.minute === 45 && state.addedTime === 0) {
      state.addedTime = rollAddedTime(state.rng, MATCH.addedTimeFirstHalf);
    }
    if (state.half === 2 && state.minute === MATCH.minutes && state.addedTime === 0) {
      state.addedTime = rollAddedTime(state.rng, MATCH.addedTimeSecondHalf);
    }

    let contextDirty = false;
    let stopReason: SegmentBoundary | null = null;

    // Chance-creating moments.
    for (const isHome of [true, false]) {
      const rate = isHome ? ctx.homeMomentRate : ctx.awayMomentRate;
      const share = isHome ? ctx.homePossession : 1 - ctx.homePossession;
      const perMinute = CHANCES.baseMomentsPerMinute * rate * share;

      if (chance(state.rng, perMinute)) {
        const { scored } = resolveChance(state, ctx, isHome, emit);
        if (scored) {
          contextDirty = true;
          if (stopAtEvents) stopReason = "goal";
        }
      }

      // This side's own pressing can win the ball back high and spring a counter.
      const pressingTactics = isHome ? state.home.tactics : state.away.tactics;
      if (chance(state.rng, turnoverChance(pressingTactics) * 0.25)) {
        const { scored } = resolveChance(state, ctx, isHome, emit, "counter");
        if (scored) {
          contextDirty = true;
          if (stopAtEvents) stopReason = "goal";
        }
      }
    }

    // Fouls.
    for (const isHome of [true, false]) {
      const rate = isHome ? ctx.homeFoulRate : ctx.awayFoulRate;
      if (chance(state.rng, rate)) {
        const { red, penaltyScored } = resolveFoul(state, ctx, isHome, emit);
        if (red || penaltyScored) {
          contextDirty = true;
          if (stopAtEvents) stopReason = red ? "red_card" : "goal";
        }
      }
    }

    // Fitness and injuries.
    const { injuryForcedSub } = tickFitnessAndInjuries(state, emit);
    if (injuryForcedSub && stopAtEvents) stopReason = "injury";

    // Periodic rating drift so the numbers reflect how the match is going.
    if (state.minute % 15 === 0) {
      applyTeamDrift(state.home.onPitch, state.homeGoals - state.awayGoals);
      applyTeamDrift(state.away.onPitch, state.awayGoals - state.homeGoals);
      contextDirty = true;
    }

    // Managers react.
    if (onMinute && onMinute(state, emit)) contextDirty = true;

    if (contextDirty) ctx = buildContext(state);

    if (stopReason) {
      boundary = stopReason;
      return { state, events, boundary };
    }

    if (state.minute - startMinute >= maxMinutes && stopAtEvents) {
      return { state, events, boundary: "interval" };
    }
  }

  // Full time.
  finishMatch(state, emit);
  return { state, events, boundary: "fulltime" };
}

function finishMatch(state: MatchState, emit: Emitter): void {
  if (state.finished) return;
  state.finished = true;

  const homePlayers = [...state.home.onPitch, ...state.home.bench];
  const awayPlayers = [...state.away.onPitch, ...state.away.bench];

  if (state.awayGoals === 0) applyCleanSheet(homePlayers);
  if (state.homeGoals === 0) applyCleanSheet(awayPlayers);

  // Possession is reported as a whole-match figure.
  const homeShare = buildContext(state).homePossession;
  state.homeStats.possession = Math.round(homeShare * 100);
  state.awayStats.possession = 100 - state.homeStats.possession;

  emit({
    type: "fulltime",
    clubId: null,
    playerId: null,
    secondPlayerId: null,
    commentary: fullTimeLine(
      state.home.clubName,
      state.homeGoals,
      state.away.clubName,
      state.awayGoals,
    ),
    data: { homeGoals: state.homeGoals, awayGoals: state.awayGoals },
  });
}

/** Runs a match from its current state through to full time. */
export function simulateToEnd(
  state: MatchState,
  onMinute?: (state: MatchState, emit: Emitter) => boolean,
): MatchEvent[] {
  const all: MatchEvent[] = [];
  let guard = 0;

  while (!state.finished && guard++ < 400) {
    const { events } = simulateSegment(state, { onMinute, stopAtEvents: false });
    all.push(...events);
  }

  return all;
}

type InjuryRecord = { severity: InjurySeverity; outRounds: number };

function playerResults(
  side: MatchSide,
  injuries: Map<number, InjuryRecord>,
): PlayerMatchResult[] {
  const all = [...side.onPitch, ...side.bench];
  return all
    .filter((lp) => lp.minutesPlayed > 0)
    .map((lp) => ({
      playerId: lp.player.id,
      clubId: side.clubId,
      minutesPlayed: lp.minutesPlayed,
      goals: lp.goals,
      assists: lp.assists,
      yellowCards: Math.min(lp.yellowCards, 2),
      redCards: lp.sentOff ? 1 : 0,
      rating: finalRating(lp),
      endFitness: Math.round(lp.fitness * 10) / 10,
      injury: injuries.get(lp.player.id) ?? null,
    }));
}

/**
 * Packages a finished match for the caller: the result, the stats, and the
 * per-player outcomes that fold back into career state.
 */
export function buildMatchResult(state: MatchState, events: MatchEvent[]): MatchResult {
  const injuries = new Map<number, InjuryRecord>();
  for (const event of events) {
    if (event.type !== "injury" || event.playerId === null) continue;
    const { severity, outRounds } = event.data ?? {};
    // Knocks cost no rounds and are not carried into career state.
    if (severity && outRounds) injuries.set(event.playerId, { severity, outRounds });
  }

  return {
    fixtureId: state.fixtureId,
    homeClubId: state.home.clubId,
    awayClubId: state.away.clubId,
    homeGoals: state.homeGoals,
    awayGoals: state.awayGoals,
    homeStats: state.homeStats,
    awayStats: state.awayStats,
    events,
    players: [...playerResults(state.home, injuries), ...playerResults(state.away, injuries)],
  };
}

export type { Emitter };
