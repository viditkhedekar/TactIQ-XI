/**
 * The cup: a straight knockout with the smaller clubs let in early.
 *
 * The shape is chosen to make giant-killings possible without making them
 * routine. Thirty-two clubs enter: the twenty from the division and twelve from
 * below it, so the first round is where a top-flight side can be embarrassed
 * and the later rounds are mostly the division playing itself.
 *
 * Draws are random and unseeded by strength, which is the whole point of a cup.
 * The randomness is deterministic per career and season, so a draw can be
 * regenerated rather than stored twice.
 */

import { chance, shuffle, type RngState } from "./rng";

export const CUP = {
  /** Clubs entering the first round. A power of two, so no byes are needed. */
  entrants: 32,
  /** How many of those come from below the top flight. */
  lowerLeagueEntrants: 12,
  /** Rounds from the first to the final: 32 -> 16 -> 8 -> 4 -> 2 -> winner. */
  rounds: 5,

  /**
   * Which league round each cup round is played alongside.
   *
   * Spread across the season and kept clear of the last few rounds, so the
   * final is not competing with a title run-in for the manager's attention.
   */
  roundSchedule: [4, 10, 17, 24, 31] as const,
} as const;

export const CUP_ROUND_NAMES: Record<number, string> = {
  1: "First round",
  2: "Second round",
  3: "Quarter-final",
  4: "Semi-final",
  5: "Final",
};

export function cupRoundName(cupRound: number): string {
  return CUP_ROUND_NAMES[cupRound] ?? `Round ${cupRound}`;
}

/** The league round a given cup round is played in. */
export function leagueRoundForCupRound(cupRound: number): number {
  return CUP.roundSchedule[cupRound - 1] ?? 0;
}

/** Whether any cup tie is played in this league round. */
export function cupRoundForLeagueRound(round: number): number | null {
  const index = CUP.roundSchedule.indexOf(round as (typeof CUP.roundSchedule)[number]);
  return index === -1 ? null : index + 1;
}

export type CupTie = {
  cupRound: number;
  homeClubId: number;
  awayClubId: number;
};

/**
 * Pairs up whoever is left.
 *
 * Home advantage is decided by the draw rather than by seeding, so a lower
 * league club can and often will get the tie at home, which is exactly the
 * circumstance that produces an upset.
 */
export function drawRound(rng: RngState, clubIds: number[], cupRound: number): CupTie[] {
  const drawn = shuffle(rng, clubIds);
  const ties: CupTie[] = [];

  for (let i = 0; i + 1 < drawn.length; i += 2) {
    ties.push({ cupRound, homeClubId: drawn[i], awayClubId: drawn[i + 1] });
  }

  return ties;
}

/**
 * Who enters the cup.
 *
 * The whole division plus enough smaller clubs to fill the bracket. Taking the
 * lower league entrants at random each season means the same small clubs are
 * not in it every year.
 */
export function selectEntrants(
  rng: RngState,
  divisionClubIds: number[],
  lowerPool: number[],
): number[] {
  const lower = shuffle(rng, lowerPool).slice(0, CUP.lowerLeagueEntrants);
  const entrants = [...divisionClubIds, ...lower];

  // If the pool cannot fill the bracket, the bracket shrinks to the largest
  // power of two that fits rather than leaving a tie with one club in it.
  const size = Math.pow(2, Math.floor(Math.log2(entrants.length)));
  return shuffle(rng, entrants).slice(0, size);
}

/**
 * Who goes through when a tie is level after ninety minutes.
 *
 * Penalties are a coin flip weighted only slightly by squad quality: shootouts
 * are close to random in reality, and making the better side reliably win them
 * would remove the drama that justifies having them at all.
 */
export function penaltyShootout(
  rng: RngState,
  home: { clubId: number; strength: number },
  away: { clubId: number; strength: number },
): { winnerClubId: number; homeScore: number; awayScore: number } {
  /*
   * The quality gap barely matters, and the divisor is what enforces that.
   *
   * A thirty-point gulf in squad strength moves each side's conversion rate by
   * under four points, so the better team is a slight favourite rather than a
   * near certainty. Anything stronger and the shootout stops being a shootout:
   * the whole reason to simulate one rather than award the tie to the better
   * side is that it is close to a coin flip.
   */
  const edge = (home.strength - away.strength) / 800;
  const homeConversion = 0.75 + edge;
  const awayConversion = 0.75 - edge;

  let homeScore = 0;
  let awayScore = 0;

  // Best of five, then sudden death, exactly as a real shootout runs.
  for (let i = 0; i < 5; i += 1) {
    if (rngChance(rng, homeConversion)) homeScore += 1;
    if (rngChance(rng, awayConversion)) awayScore += 1;
  }

  let guard = 0;
  while (homeScore === awayScore && guard < 20) {
    if (rngChance(rng, homeConversion)) homeScore += 1;
    if (rngChance(rng, awayConversion)) awayScore += 1;
    guard += 1;
  }

  // A shootout that somehow never separates them falls to the home side, which
  // is arbitrary but has to be something and can never be reached in practice.
  return {
    winnerClubId: homeScore >= awayScore ? home.clubId : away.clubId,
    homeScore,
    awayScore,
  };
}

/**
 * A single penalty. The rate is clamped well short of both ends so that even a
 * vast gulf in quality cannot turn a shootout into a formality.
 */
function rngChance(rng: RngState, p: number): boolean {
  return chance(rng, Math.max(0.35, Math.min(0.95, p)));
}
