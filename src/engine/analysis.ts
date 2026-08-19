/**
 * Reading a finished match.
 *
 * The manager has just watched ninety minutes and wants to know what actually
 * happened, which is not the same as the scoreline. This module turns a
 * completed match into a verdict: how each player did, which parts of the
 * performance held up, which did not, and what the week's training should be
 * spent on as a result.
 *
 * Every judgement is made against a par figure rather than against the
 * opponent, so a win can still be told it was wasteful and a defeat can be told
 * the defending was fine. Par values come from the same Premier League
 * reference rates the engine is calibrated to, and each note carries the
 * numbers that produced it: a verdict the manager cannot check is a verdict
 * they cannot learn from.
 *
 * Pure and framework-free, like the rest of the engine. It reads a finished
 * MatchState and its events, and returns a plain object.
 */

import { finalRating } from "./playerRating";
import type { TrainingFocus } from "./training";
import { isShotEvent } from "./types";
import type {
  ChanceType,
  LineupPlayer,
  MatchEvent,
  MatchSide,
  MatchState,
} from "./types";

/** Par figures for a single team in a single match. */
const PAR = {
  xg: 1.4,
  shots: 12.5,
  shotsOnTarget: 4.3,
  possession: 50,
  fouls: 10,
  yellows: 2,
  /** Average fitness a starter is expected to finish on. */
  endFitness: 62,
  /** Rating at which a performance stops being ordinary in either direction. */
  goodRating: 7.2,
  poorRating: 5.9,
};

export type AnalysisVerdict = "strong" | "solid" | "adequate" | "weak" | "poor";

export type AnalysisAreaKey =
  | "finishing"
  | "creation"
  | "defence"
  | "goalkeeping"
  | "aerial"
  | "wide"
  | "control"
  | "discipline"
  | "fitness";

export type AnalysisArea = {
  key: AnalysisAreaKey;
  label: string;
  /** 0 to 100, where 50 is par for a match at this level. */
  score: number;
  verdict: AnalysisVerdict;
  /** One sentence carrying the numbers the verdict was made on. */
  note: string;
  /** The training that would address this, where training can. */
  focus: TrainingFocus | null;
};

export type PlayerReport = {
  playerId: number;
  clubId: number;
  name: string;
  slot: string;
  minutes: number;
  rating: number;
  goals: number;
  assists: number;
  shots: number;
  saves: number;
  yellowCards: number;
  sentOff: boolean;
  endFitness: number;
  injured: boolean;
  cameOn: boolean;
  substituted: boolean;
  standout: "motm" | "good" | "poor" | null;
};

export type TrainingRecommendation = {
  focus: TrainingFocus;
  reason: string;
};

export type IndividualRecommendation = {
  playerId: number;
  name: string;
  focus: TrainingFocus;
  reason: string;
};

export type MatchAnalysis = {
  fixtureId: string;
  clubId: number;
  opponentClubId: number;
  clubName: string;
  opponentName: string;
  isHome: boolean;
  goalsFor: number;
  goalsAgainst: number;
  result: "win" | "draw" | "loss";
  headline: string;
  /** Both sides, so the page can show the opposition's ratings too. */
  players: PlayerReport[];
  manOfTheMatchId: number | null;
  areas: AnalysisArea[];
  positives: string[];
  concerns: string[];
  recommendedTraining: TrainingRecommendation[];
  individualWork: IndividualRecommendation[];
};

/* ------------------------------------------------------------------ scoring */

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function verdictFor(score: number): AnalysisVerdict {
  if (score >= 72) return "strong";
  if (score >= 60) return "solid";
  if (score >= 44) return "adequate";
  if (score >= 30) return "weak";
  return "poor";
}

/** English for a count, because "1 goals" reads like a bug. */
function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/* -------------------------------------------------------------- event reading */

type ChanceTally = {
  /** Shots taken, by where the chance came from. */
  byType: Map<ChanceType, number>;
  /** Expected goals, by where the chance came from. */
  xgByType: Map<ChanceType, number>;
  goalsByType: Map<ChanceType, number>;
};

function tallyChances(events: MatchEvent[], clubId: number): ChanceTally {
  const tally: ChanceTally = {
    byType: new Map(),
    xgByType: new Map(),
    goalsByType: new Map(),
  };

  for (const event of events) {
    if (event.clubId !== clubId) continue;
    if (!isShotEvent(event.type)) continue;

    const type = event.data?.chanceType;
    if (!type) continue;

    tally.byType.set(type, (tally.byType.get(type) ?? 0) + 1);
    tally.xgByType.set(type, (tally.xgByType.get(type) ?? 0) + (event.data?.xg ?? 0));
    if (event.type === "goal") {
      tally.goalsByType.set(type, (tally.goalsByType.get(type) ?? 0) + 1);
    }
  }

  return tally;
}

/** Goals conceded in the closing quarter, which is usually a fitness story. */
function lateGoalsConceded(events: MatchEvent[], opponentClubId: number): number {
  return events.filter(
    (e) => e.type === "goal" && e.clubId === opponentClubId && e.minute >= 75,
  ).length;
}

/* ------------------------------------------------------------------ players */

function reportFor(side: MatchSide, lp: LineupPlayer): PlayerReport {
  return {
    playerId: lp.player.id,
    clubId: side.clubId,
    name: lp.player.name,
    slot: lp.slot,
    minutes: lp.minutesPlayed,
    rating: finalRating(lp),
    goals: lp.goals,
    assists: lp.assists,
    shots: lp.shots,
    saves: lp.saves,
    yellowCards: Math.min(lp.yellowCards, 2),
    sentOff: lp.sentOff,
    endFitness: Math.round(lp.fitness),
    injured: lp.injured,
    cameOn: lp.onAtMinute > 0,
    substituted: lp.offAtMinute !== null && !lp.sentOff,
    standout: null,
  };
}

function playerReports(side: MatchSide): PlayerReport[] {
  return [...side.onPitch, ...side.bench]
    .filter((lp) => lp.minutesPlayed > 0)
    .map((lp) => reportFor(side, lp))
    .sort((a, b) => b.rating - a.rating);
}

/**
 * Marks the standouts. A substitute needs less time than a starter to be
 * called poor, but not so little that a man on for five minutes is blamed for
 * the afternoon.
 */
function markStandouts(players: PlayerReport[], motmId: number | null): void {
  for (const p of players) {
    if (p.playerId === motmId) {
      p.standout = "motm";
    } else if (p.rating >= PAR.goodRating && p.minutes >= 20) {
      p.standout = "good";
    } else if (p.rating <= PAR.poorRating && p.minutes >= 30) {
      p.standout = "poor";
    }
  }
}

/* -------------------------------------------------------------------- areas */

function buildAreas(
  ours: MatchSide,
  theirs: MatchSide,
  state: MatchState,
  events: MatchEvent[],
  weAreHome: boolean,
): AnalysisArea[] {
  const ourStats = weAreHome ? state.homeStats : state.awayStats;
  const theirStats = weAreHome ? state.awayStats : state.homeStats;
  const goalsFor = weAreHome ? state.homeGoals : state.awayGoals;
  const goalsAgainst = weAreHome ? state.awayGoals : state.homeGoals;

  const ourChances = tallyChances(events, ours.clubId);
  const theirChances = tallyChances(events, theirs.clubId);

  const areas: AnalysisArea[] = [];

  /* Finishing: what we did with what we made. */
  {
    // Guarded so a match with almost no chances does not report a wild ratio.
    const expected = Math.max(ourStats.xg, 0.4);
    const conversion = goalsFor / expected;
    const score = clampScore(50 + (conversion - 1) * 34);
    const note =
      goalsFor > ourStats.xg + 0.5
        ? `${plural(goalsFor, "goal")} from ${round1(ourStats.xg)} expected. Clinical.`
        : goalsFor + 0.7 < ourStats.xg
          ? `${plural(goalsFor, "goal")} from ${round1(ourStats.xg)} expected. Chances went begging.`
          : `${plural(goalsFor, "goal")} from ${round1(ourStats.xg)} expected, which is about right.`;

    areas.push({
      key: "finishing",
      label: "Finishing",
      score,
      verdict: verdictFor(score),
      note,
      focus: score < 44 ? "finishing" : null,
    });
  }

  /* Creation: how much we made in the first place. */
  {
    const score = clampScore(50 + (ourStats.xg - PAR.xg) * 26);
    const bigChances = ourStats.bigChances;
    const note = `${plural(ourStats.shots, "shot")}, ${ourStats.shotsOnTarget} on target, ${round1(ourStats.xg)} expected goals${
      bigChances > 0 ? ` and ${plural(bigChances, "clear chance")}` : " and nothing clear-cut"
    }.`;

    areas.push({
      key: "creation",
      label: "Chance creation",
      score,
      verdict: verdictFor(score),
      note,
      focus: score < 44 ? "creativity" : null,
    });
  }

  /* Defence: how much we let them make. */
  {
    const score = clampScore(50 - (theirStats.xg - PAR.xg) * 26);
    const note = `Allowed ${plural(theirStats.shots, "shot")} and ${round1(theirStats.xg)} expected goals against.`;

    areas.push({
      key: "defence",
      label: "Defending",
      score,
      verdict: verdictFor(score),
      note,
      focus: score < 44 ? "defending" : null,
    });
  }

  /* Goalkeeping: goals conceded measured against the chances faced. */
  {
    const keeper = ours.onPitch.find((lp) => lp.player.isGk);
    const saves = keeper?.saves ?? 0;
    const score = clampScore(50 + (theirStats.xg - goalsAgainst) * 28);
    const note =
      goalsAgainst === 0
        ? `A clean sheet, with ${plural(saves, "save")} made.`
        : `${plural(goalsAgainst, "goal")} conceded from ${round1(theirStats.xg)} expected, ${plural(saves, "save")} made.`;

    areas.push({
      key: "goalkeeping",
      label: "Goalkeeping",
      score,
      verdict: verdictFor(score),
      note,
      focus: score < 38 ? "goalkeeping" : null,
    });
  }

  /* Aerial: what crosses and set pieces did to us, and for us. */
  {
    const concededAerial =
      (theirChances.goalsByType.get("cross") ?? 0) +
      (theirChances.goalsByType.get("set_piece") ?? 0);
    const scoredAerial =
      (ourChances.goalsByType.get("cross") ?? 0) +
      (ourChances.goalsByType.get("set_piece") ?? 0);
    const facedAerialXg =
      (theirChances.xgByType.get("cross") ?? 0) +
      (theirChances.xgByType.get("set_piece") ?? 0);

    const score = clampScore(50 - concededAerial * 20 + scoredAerial * 12 - (facedAerialXg - 0.5) * 14);
    const note =
      concededAerial > 0
        ? `${plural(concededAerial, "goal")} conceded from crosses and set pieces.`
        : scoredAerial > 0
          ? `${plural(scoredAerial, "goal")} of your own from crosses and set pieces, and none conceded that way.`
          : `Nothing conceded in the air, from ${round1(facedAerialXg)} expected off crosses and set pieces.`;

    areas.push({
      key: "aerial",
      label: "Aerial and set pieces",
      score,
      verdict: verdictFor(score),
      note,
      focus: score < 40 ? "aerial" : null,
    });
  }

  /* Wide play: whether crossing was worth doing. */
  {
    const crosses = ourChances.byType.get("cross") ?? 0;
    const crossXg = ourChances.xgByType.get("cross") ?? 0;
    const perCross = crosses > 0 ? crossXg / crosses : 0;

    // Judged on quality per attempt, not volume: a side that crosses twice and
    // scores is doing better than one that crosses fifteen times for nothing.
    const score =
      crosses === 0
        ? 50
        : clampScore(50 + (perCross - 0.11) * 260 + (ourChances.goalsByType.get("cross") ?? 0) * 10);
    const note =
      crosses === 0
        ? "No real width to the attack. Everything went through the middle."
        : `${plural(crosses, "chance")} from wide areas, worth ${round1(crossXg)} between them.`;

    areas.push({
      key: "wide",
      label: "Wide play",
      score,
      verdict: verdictFor(score),
      note,
      focus: score < 42 ? "wing_play" : null,
    });
  }

  /* Control: possession. */
  {
    const possession = ourStats.possession;
    const score = clampScore(50 + (possession - PAR.possession) * 1.3);
    const note = `${possession} percent of the ball.`;

    areas.push({
      key: "control",
      label: "Control",
      score,
      verdict: verdictFor(score),
      note,
      focus: score < 38 ? "possession" : null,
    });
  }

  /* Discipline. */
  {
    const score = clampScore(
      50 - (ourStats.yellowCards - PAR.yellows) * 11 - ourStats.redCards * 26 -
        (ourStats.fouls - PAR.fouls) * 1.6,
    );
    const note =
      ourStats.redCards > 0
        ? `${plural(ourStats.fouls, "foul")}, ${plural(ourStats.yellowCards, "booking")} and a sending off.`
        : `${plural(ourStats.fouls, "foul")} and ${plural(ourStats.yellowCards, "booking")}.`;

    areas.push({
      key: "discipline",
      label: "Discipline",
      score,
      verdict: verdictFor(score),
      note,
      focus: score < 42 ? "discipline" : null,
    });
  }

  /* Fitness: how the side finished, and what it cost late on. */
  {
    const starters = ours.onPitch.filter((lp) => lp.onAtMinute === 0 && !lp.player.isGk);
    const finishers = starters.length > 0 ? starters : ours.onPitch;
    const averageEnd =
      finishers.reduce((sum, lp) => sum + lp.fitness, 0) / Math.max(1, finishers.length);
    const late = lateGoalsConceded(events, theirs.clubId);

    const score = clampScore(50 + (averageEnd - PAR.endFitness) * 1.6 - late * 14);
    const note =
      late > 0
        ? `Starters finished on ${Math.round(averageEnd)} percent, and ${plural(late, "goal")} went in after the 75th minute.`
        : `Starters finished on ${Math.round(averageEnd)} percent and saw the game out.`;

    areas.push({
      key: "fitness",
      label: "Fitness",
      score,
      verdict: verdictFor(score),
      note,
      focus: score < 40 ? "fitness" : null,
    });
  }

  return areas;
}

/* ---------------------------------------------------------------- headlines */

function headlineFor(
  result: "win" | "draw" | "loss",
  goalsFor: number,
  goalsAgainst: number,
  opponentName: string,
  areas: AnalysisArea[],
): string {
  const score = `${goalsFor}-${goalsAgainst}`;
  const worst = [...areas].sort((a, b) => a.score - b.score)[0];
  const best = [...areas].sort((a, b) => b.score - a.score)[0];

  if (result === "win") {
    return worst.score < 36
      ? `${score} against ${opponentName}, and the three points flatter you. ${worst.label} needs attention.`
      : `${score} against ${opponentName}. ${best.label} was the difference.`;
  }

  if (result === "draw") {
    return `${score} with ${opponentName}. ${best.label} held up; ${worst.label.toLowerCase()} did not.`;
  }

  return worst.score < 36
    ? `${score} to ${opponentName}. ${worst.label} lost you this one.`
    : `${score} to ${opponentName}, and there was not a great deal in it.`;
}

/* ------------------------------------------------------------ training plan */

/** The work each area maps to, regardless of how badly it went. */
const AREA_FOCUS: Record<AnalysisAreaKey, TrainingFocus> = {
  finishing: "finishing",
  creation: "creativity",
  defence: "defending",
  goalkeeping: "goalkeeping",
  aerial: "aerial",
  wide: "wing_play",
  control: "possession",
  discipline: "discipline",
  fitness: "fitness",
};

/**
 * Turns the weakest areas into a training plan.
 *
 * Capped at three, because a manager given nine things to fix will fix none of
 * them, and a week only has so many sessions in it.
 *
 * A performance with nothing actually wrong with it still gets a suggestion.
 * After a good win the honest answer is "your weakest area was still wide
 * play", and a report that shrugs and says nothing is a report the manager
 * stops opening.
 */
function recommendTraining(areas: AnalysisArea[]): TrainingRecommendation[] {
  const ranked = [...areas].sort((a, b) => a.score - b.score);
  const seen = new Set<TrainingFocus>();
  const out: TrainingRecommendation[] = [];

  for (const area of ranked) {
    if (!area.focus || seen.has(area.focus)) continue;
    seen.add(area.focus);
    out.push({ focus: area.focus, reason: `${area.label}: ${area.note}` });
    if (out.length === 3) break;
  }

  if (out.length > 0) return out;

  // Nothing was bad enough to flag, so name the weakest area anyway.
  const weakest = ranked[0];
  return weakest
    ? [
        {
          focus: AREA_FOCUS[weakest.key],
          reason: `Nothing went badly wrong. ${weakest.label} was your quietest area: ${weakest.note}`,
        },
      ]
    : [];
}

/** Which slots suggest which sort of extra work, when a player is struggling. */
const SLOT_FOCUS: Record<string, TrainingFocus> = {
  GK: "goalkeeping",
  LB: "defending",
  RB: "defending",
  LCB: "defending",
  CB: "defending",
  RCB: "defending",
  LWB: "wing_play",
  RWB: "wing_play",
  CDM: "defending",
  LCM: "possession",
  CM: "possession",
  RCM: "possession",
  CAM: "creativity",
  LM: "wing_play",
  RM: "wing_play",
  LW: "wing_play",
  RW: "wing_play",
  ST: "finishing",
  LST: "finishing",
  RST: "finishing",
};

/**
 * Individual attention. Picks the players whose afternoon was poor enough to
 * be worth naming, and says what they should be working on.
 */
function recommendIndividuals(players: PlayerReport[]): IndividualRecommendation[] {
  return players
    .filter((p) => p.standout === "poor")
    .slice(0, 4)
    .map((p) => {
      // A booking is the clearest single thing a player can be told to fix, so
      // it takes priority over whatever their position would otherwise suggest.
      const focus =
        p.sentOff || p.yellowCards >= 1
          ? "discipline"
          : (SLOT_FOCUS[p.slot] ?? "balanced");

      const reason = p.sentOff
        ? `Sent off, and rated ${p.rating.toFixed(1)}.`
        : p.yellowCards >= 1
          ? `Booked and rated ${p.rating.toFixed(1)} in ${p.minutes} minutes.`
          : p.shots >= 3 && p.goals === 0
            ? `${plural(p.shots, "shot")} without scoring, rated ${p.rating.toFixed(1)}.`
            : `Rated ${p.rating.toFixed(1)} over ${p.minutes} minutes.`;

      return { playerId: p.playerId, name: p.name, focus, reason };
    });
}

/* ------------------------------------------------------------------- public */

/**
 * Builds the post-match report for one club's point of view.
 *
 * `clubId` is whose report this is. Everything is framed from their side: their
 * goals are `goalsFor`, and an area scoring badly is their problem.
 */
export function analyseMatch(
  state: MatchState,
  events: MatchEvent[],
  clubId: number,
): MatchAnalysis {
  const weAreHome = state.home.clubId === clubId;
  const ours = weAreHome ? state.home : state.away;
  const theirs = weAreHome ? state.away : state.home;

  const goalsFor = weAreHome ? state.homeGoals : state.awayGoals;
  const goalsAgainst = weAreHome ? state.awayGoals : state.homeGoals;
  const result = goalsFor > goalsAgainst ? "win" : goalsFor === goalsAgainst ? "draw" : "loss";

  const ourPlayers = playerReports(ours);
  const theirPlayers = playerReports(theirs);
  const everyone = [...ourPlayers, ...theirPlayers];

  // Man of the match is taken across both sides, the way it is awarded. A
  // substitute is only eligible once he has been on long enough to earn it.
  const eligible = everyone.filter((p) => p.minutes >= 25);
  const motm = eligible.reduce<PlayerReport | null>(
    (best, p) => (best === null || p.rating > best.rating ? p : best),
    null,
  );

  markStandouts(ourPlayers, motm?.playerId ?? null);
  markStandouts(theirPlayers, motm?.playerId ?? null);

  const areas = buildAreas(ours, theirs, state, events, weAreHome);

  return {
    fixtureId: state.fixtureId,
    clubId: ours.clubId,
    opponentClubId: theirs.clubId,
    clubName: ours.clubName,
    opponentName: theirs.clubName,
    isHome: weAreHome,
    goalsFor,
    goalsAgainst,
    result,
    headline: headlineFor(result, goalsFor, goalsAgainst, theirs.clubName, areas),
    players: [...ourPlayers, ...theirPlayers],
    manOfTheMatchId: motm?.playerId ?? null,
    areas,
    positives: areas.filter((a) => a.score >= 62).map((a) => `${a.label}: ${a.note}`),
    concerns: areas.filter((a) => a.score <= 40).map((a) => `${a.label}: ${a.note}`),
    recommendedTraining: recommendTraining(areas),
    individualWork: recommendIndividuals(ourPlayers),
  };
}
