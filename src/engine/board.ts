/**
 * The board: what they expect, what they think of you, and when they act.
 *
 * The central idea is that a result means nothing on its own. Seventh is a fine
 * season for a club expected to survive and a sacking offence for one expected
 * to win the league, so everything here is measured against an expectation set
 * at the start of the season from squad strength. That single comparison is
 * what makes the board feel like it is watching the same season the manager is.
 *
 * Pure and seedless: it takes the state of a season and returns numbers and
 * sentences. Nothing here reads the database or decides when to be called.
 */

export const BOARD = {
  /** Confidence starts here for a new job: cautious optimism, not a blank slate. */
  startingConfidence: 65,
  min: 0,
  max: 100,

  /**
   * Below this, the board is unhappy enough to act. Not immediately: it has to
   * stay there for `roundsBeforeSacking` rounds, so one bad month is survivable
   * and a bad half-season is not.
   */
  sackThreshold: 25,
  /** Consecutive rounds under the threshold before the manager is dismissed. */
  roundsBeforeSacking: 5,
  /** The board goes public with its concerns at this level, as a warning. */
  pressureThreshold: 38,

  /**
   * How fast confidence moves. Deliberately slow: confidence that swung twenty
   * points a week would make the whole system noise rather than a judgement.
   */
  driftPerRound: 0.22,

  /** Weight of each area in the overall figure. They sum to 1. */
  weights: {
    league: 0.5,
    cup: 0.15,
    finance: 0.2,
    squad: 0.15,
  },

  /** A season this far above expectation is as good as it gets. */
  positionSwing: 8,

  /** Relegation ends a job, whatever the confidence figure says. */
  relegationIsFatal: true,
} as const;

export type ConfidenceAreaKey = "league" | "cup" | "finance" | "squad";

export type ConfidenceArea = {
  key: ConfidenceAreaKey;
  label: string;
  /** 0 to 100. */
  score: number;
  verdict: "delighted" | "pleased" | "content" | "concerned" | "furious";
  /** One sentence the board would actually say, with the numbers in it. */
  note: string;
};

export type BoardView = {
  /** The weighted overall, 0 to 100. */
  confidence: number;
  areas: ConfidenceArea[];
  expectedPosition: number;
  /** What the board says at the top of the screen. */
  summary: string;
  underPressure: boolean;
  /** Rounds of danger survived so far, and how many end the job. */
  roundsInDanger: number;
  roundsBeforeSacking: number;
};

function verdictFor(score: number): ConfidenceArea["verdict"] {
  if (score >= 80) return "delighted";
  if (score >= 62) return "pleased";
  if (score >= 45) return "content";
  if (score >= 26) return "concerned";
  return "furious";
}

function clamp(value: number): number {
  return Math.max(BOARD.min, Math.min(BOARD.max, value));
}

/** Ordinal for a league position, since the board talks in "4th" not "4". */
export function ordinal(n: number): string {
  const suffix =
    n % 100 >= 11 && n % 100 <= 13
      ? "th"
      : n % 10 === 1
        ? "st"
        : n % 10 === 2
          ? "nd"
          : n % 10 === 3
            ? "rd"
            : "th";
  return `${n}${suffix}`;
}

/**
 * Where a board expects a squad to finish.
 *
 * Ranked purely on squad strength against the rest of the division, which is
 * both the fairest yardstick and the one a manager can argue with: sign better
 * players and next summer's expectation rises with them.
 */
export function expectationFromStrength(
  ownStrength: number,
  allStrengths: number[],
): number {
  const sorted = [...allStrengths].sort((a, b) => b - a);
  const index = sorted.findIndex((s) => s <= ownStrength);
  return Math.max(1, Math.min(sorted.length, (index === -1 ? sorted.length : index) + 1));
}

export type SeasonProgress = {
  /** Where the club currently sits, and where it was expected to. */
  position: number;
  expectedPosition: number;
  clubCount: number;
  played: number;
  totalRounds: number;
  /** How far the cup run got: 0 for out in the first round, or not entered. */
  cupRoundsWon: number;
  cupTotalRounds: number;
  cupWon: boolean;
  /** Whether the club went out to a side from below the top flight. */
  cupGiantKilled: boolean;
  /** Budget as a share of what they started with: 1 is untouched, 0 is spent. */
  budgetRemaining: number;
  /** Whether the wage bill is inside what the board sanctioned. */
  wagesWithinBudget: boolean;
  /** Average rating of players signed this season, or null if none were. */
  signingRating: number | null;
  /** Share of minutes given to players 21 and under. */
  youthMinuteShare: number;
  /** Goals scored per game, which is the board's proxy for entertainment. */
  goalsPerGame: number;
};

/* ------------------------------------------------------------------- areas */

function leagueArea(p: SeasonProgress): ConfidenceArea {
  // Above expectation is positive, below is negative, scaled so that missing by
  // the whole division is a zero and beating it by a lot is full marks.
  const delta = p.expectedPosition - p.position;
  const score = clamp(55 + (delta / BOARD.positionSwing) * 45);

  const note =
    p.played === 0
      ? `They expect ${ordinal(p.expectedPosition)} this season.`
      : delta > 1
        ? `${ordinal(p.position)} against an expected ${ordinal(p.expectedPosition)}. Ahead of where they hoped.`
        : delta < -1
          ? `${ordinal(p.position)} against an expected ${ordinal(p.expectedPosition)}. Below where they hoped.`
          : `${ordinal(p.position)}, which is about where they expected.`;

  return { key: "league", label: "League position", score, verdict: verdictFor(score), note };
}

function cupArea(p: SeasonProgress): ConfidenceArea {
  // A cup nobody has played yet is not a bad cup run. `cupTotalRounds` of zero
  // is how "not entered, or not started" arrives here, and it has to be judged
  // as neutral rather than as an early exit.
  if (p.cupTotalRounds === 0) {
    return {
      key: "cup",
      label: "Cup run",
      score: 55,
      verdict: "content",
      note: "The cup has not started yet.",
    };
  }

  if (p.cupWon) {
    return {
      key: "cup",
      label: "Cup run",
      score: 100,
      verdict: "delighted",
      note: "They have the cup in the boardroom. Nothing else needed saying.",
    };
  }

  // Progress through the rounds, with going out to a smaller club punished
  // beyond the round it happened in: that is the humiliation, not the exit.
  const progress = p.cupTotalRounds > 0 ? p.cupRoundsWon / p.cupTotalRounds : 0;
  const score = clamp(38 + progress * 62 - (p.cupGiantKilled ? 26 : 0));

  const note = p.cupGiantKilled
    ? "Knocked out by a club from below the division. That one stung."
    : p.cupRoundsWon === 0
      ? "Out of the cup early."
      : `${p.cupRoundsWon} ${p.cupRoundsWon === 1 ? "round" : "rounds"} of the cup negotiated.`;

  return { key: "cup", label: "Cup run", score, verdict: verdictFor(score), note };
}

function financeArea(p: SeasonProgress): ConfidenceArea {
  let score = 58;

  // Spending is not itself a sin; spending badly is. A board is happiest with a
  // manager who either kept the money or turned it into players who play well.
  if (p.signingRating !== null) {
    score += (p.signingRating - 6.5) * 26;
  } else {
    score += p.budgetRemaining > 0.7 ? 6 : 0;
  }

  if (!p.wagesWithinBudget) score -= 30;

  score = clamp(score);

  const note = !p.wagesWithinBudget
    ? "The wage bill is over what they sanctioned."
    : p.signingRating === null
      ? "No money spent, and none wasted."
      : p.signingRating >= 7
        ? `The signings are playing well, averaging ${p.signingRating.toFixed(1)}.`
        : p.signingRating < 6.3
          ? `The signings are not playing well, averaging ${p.signingRating.toFixed(1)}.`
          : `The signings are settling in at ${p.signingRating.toFixed(1)}.`;

  return { key: "finance", label: "Transfers and finances", score, verdict: verdictFor(score), note };
}

function squadArea(p: SeasonProgress): ConfidenceArea {
  // Two things at once: are the kids getting a chance, and is it watchable.
  const youth = Math.min(1, p.youthMinuteShare / 0.18);
  const entertainment = Math.min(1, p.goalsPerGame / 1.9);
  const score = clamp(30 + youth * 34 + entertainment * 36);

  const note =
    p.played === 0
      ? "Nothing to judge yet."
      : p.youthMinuteShare < 0.04
        ? "Almost no minutes for the young players."
        : p.goalsPerGame < 1
          ? `Hard to watch at times: ${p.goalsPerGame.toFixed(1)} goals a game.`
          : `${Math.round(p.youthMinuteShare * 100)} percent of minutes to under-21s, ${p.goalsPerGame.toFixed(1)} goals a game.`;

  return { key: "squad", label: "Style and squad building", score, verdict: verdictFor(score), note };
}

/**
 * The board's whole view of a season so far.
 *
 * `previousConfidence` is passed in and the result eases towards the computed
 * figure rather than jumping to it, so a manager sees a board changing its mind
 * over a run of games instead of reacting to the last result.
 */
export function assessBoard(
  progress: SeasonProgress,
  previousConfidence: number,
  roundsInDanger: number,
): BoardView {
  const areas = [
    leagueArea(progress),
    cupArea(progress),
    financeArea(progress),
    squadArea(progress),
  ];

  const target = areas.reduce(
    (sum, area) => sum + area.score * BOARD.weights[area.key],
    0,
  );

  // Ease towards the target. Early in a season there is not enough evidence to
  // move far, which is why the drift is scaled by how much has been played.
  const evidence = Math.min(1, progress.played / 8);
  const confidence = clamp(
    previousConfidence + (target - previousConfidence) * BOARD.driftPerRound * (0.4 + evidence * 0.6),
  );

  const underPressure = confidence < BOARD.pressureThreshold;

  const summary =
    confidence >= 80
      ? "The board could hardly be happier with the job being done."
      : confidence >= 62
        ? "The board is pleased with how the season is going."
        : confidence >= 45
          ? "The board is satisfied, without being excited."
          : confidence >= BOARD.sackThreshold
            ? "The board has concerns, and has stopped hiding them."
            : "The board's patience has run out. Results have to change.";

  return {
    confidence,
    areas,
    expectedPosition: progress.expectedPosition,
    summary,
    underPressure,
    roundsInDanger,
    roundsBeforeSacking: BOARD.roundsBeforeSacking,
  };
}

/** Whether this round's confidence means the manager is out of a job. */
export function shouldSack(
  confidence: number,
  roundsInDanger: number,
  options: { relegated?: boolean } = {},
): boolean {
  if (options.relegated && BOARD.relegationIsFatal) return true;
  return confidence < BOARD.sackThreshold && roundsInDanger >= BOARD.roundsBeforeSacking;
}

/* ---------------------------------------------------------------- requests */

export type RequestType = "transfer_funds" | "wage_room" | "sell_player";

export type RequestVerdict = {
  outcome: "granted" | "partial" | "refused";
  /** Euros released, for a money request. */
  grantedEur: number;
  response: string;
};

/**
 * How the board answers a request for money.
 *
 * Confidence is most of it, but not all: a board that rates its manager still
 * says no to a number it cannot afford. `headroom` is what the club could
 * plausibly release, so the answer stays inside the fiction of a real budget.
 */
export function evaluateFundsRequest(
  type: "transfer_funds" | "wage_room",
  askedEur: number,
  confidence: number,
  headroomEur: number,
  alreadyAskedThisSeason: number,
): RequestVerdict {
  const noun = type === "transfer_funds" ? "transfer funds" : "wage room";

  if (alreadyAskedThisSeason >= 2) {
    return {
      outcome: "refused",
      grantedEur: 0,
      response: `You have been to them twice already this season. They have stopped taking the meeting.`,
    };
  }

  if (confidence < 30) {
    return {
      outcome: "refused",
      grantedEur: 0,
      response: `They are not releasing ${noun} to a manager whose job they are discussing.`,
    };
  }

  // The share of the ask they will consider, before affordability.
  const willingness = (confidence - 25) / 75;
  const offered = Math.min(askedEur, Math.round(headroomEur * willingness));

  if (offered <= 0) {
    return {
      outcome: "refused",
      grantedEur: 0,
      response: `There is nothing left to release. The answer is no.`,
    };
  }

  if (offered >= askedEur) {
    return {
      outcome: "granted",
      grantedEur: askedEur,
      response: `Approved in full. The ${noun} is yours.`,
    };
  }

  return {
    outcome: "partial",
    grantedEur: offered,
    response: `They will not go to the full figure, but they will find some of it.`,
  };
}

/** The board's answer when asked to move a player on. */
export function evaluateSellRequest(
  playerName: string,
  isKeyPlayer: boolean,
  confidence: number,
): RequestVerdict {
  if (isKeyPlayer && confidence < 55) {
    return {
      outcome: "refused",
      grantedEur: 0,
      response: `${playerName} is one of the few things going well. They will not list him.`,
    };
  }

  return {
    outcome: "granted",
    grantedEur: 0,
    response: `${playerName} has been made available. They will invite offers.`,
  };
}
