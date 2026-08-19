/**
 * Fixture generation.
 *
 * A league season is a double round-robin: every club plays every other club
 * twice, once at home and once away, across 38 rounds. The circle method
 * generates the first half; the second half repeats it with the venues
 * reversed. Round order is shuffled with the career's seed so two careers
 * starting at the same club do not face the same opening run.
 */

import { shuffle, type RngState } from "./rng";

export type ScheduledFixture = {
  round: number;
  homeClubId: number;
  awayClubId: number;
};

/** An unordered pairing before anyone has been assigned a venue. */
type Pairing = { round: number; a: number; b: number };

/**
 * The circle method: fix one club and rotate the rest around it, which pairs
 * every club with every other exactly once over n-1 rounds.
 */
function generatePairings(clubs: number[]): Pairing[] {
  const n = clubs.length;
  const half = n / 2;
  const pairings: Pairing[] = [];
  const rotating = clubs.slice(1);

  for (let round = 0; round < n - 1; round++) {
    const ordered = [clubs[0], ...rotating];
    for (let i = 0; i < half; i++) {
      pairings.push({ round: round + 1, a: ordered[i], b: ordered[n - 1 - i] });
    }
    rotating.unshift(rotating.pop()!);
  }

  return pairings;
}

/**
 * Penalty for a venue assignment: how badly clubs are made to play long runs
 * of consecutive home or away fixtures. Runs of one or two are normal and cost
 * nothing; anything longer is penalised sharply.
 */
function runPenalty(
  pairings: Pairing[],
  aAtHome: boolean[],
  clubs: number[],
  roundsPerHalf: number,
): number {
  const totalRounds = roundsPerHalf * 2;
  const venues = new Map<number, ("H" | "A")[]>();
  for (const club of clubs) venues.set(club, new Array(totalRounds).fill("H"));

  pairings.forEach((p, index) => {
    const home = aAtHome[index] ? p.a : p.b;
    const away = aAtHome[index] ? p.b : p.a;
    venues.get(home)![p.round - 1] = "H";
    venues.get(away)![p.round - 1] = "A";
    // The reverse fixture sits exactly half a season later.
    venues.get(home)![p.round - 1 + roundsPerHalf] = "A";
    venues.get(away)![p.round - 1 + roundsPerHalf] = "H";
  });

  let penalty = 0;
  for (const sequence of venues.values()) {
    let run = 1;
    for (let i = 1; i < sequence.length; i++) {
      if (sequence[i] === sequence[i - 1]) {
        run++;
      } else {
        if (run > 2) penalty += (run - 2) * (run - 2);
        run = 1;
      }
    }
    if (run > 2) penalty += (run - 2) * (run - 2);
  }

  return penalty;
}

/**
 * Generates a full double round-robin for an even number of clubs.
 *
 * Pairing and venue assignment are separate problems. The circle method
 * decides who plays whom; the venues are then chosen by local search, because
 * any rule derived from the rotation index moves in step with the rotation and
 * leaves clubs with absurd runs of consecutive home games.
 *
 * Flipping a pairing swaps both legs at once, so every club still hosts every
 * other exactly once however much the search rearranges things.
 */
export function generateSchedule(clubIds: number[], rng: RngState): ScheduledFixture[] {
  if (clubIds.length < 2) return [];
  if (clubIds.length % 2 !== 0) {
    throw new Error(`Schedule needs an even number of clubs, got ${clubIds.length}`);
  }

  const clubs = shuffle(rng, clubIds);
  const roundsPerHalf = clubs.length - 1;
  const pairings = generatePairings(clubs);

  // Seed the search by alternating venues per round, then improve.
  const aAtHome = pairings.map((p, index) => (p.round + index) % 2 === 0);
  let best = runPenalty(pairings, aAtHome, clubs, roundsPerHalf);

  // Hill climbing: repeatedly take the single flip that helps most.
  for (let pass = 0; pass < 200 && best > 0; pass++) {
    let bestIndex = -1;
    let bestPenalty = best;

    for (let i = 0; i < aAtHome.length; i++) {
      aAtHome[i] = !aAtHome[i];
      const penalty = runPenalty(pairings, aAtHome, clubs, roundsPerHalf);
      aAtHome[i] = !aAtHome[i];

      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        bestIndex = i;
      }
    }

    if (bestIndex === -1) break;
    aAtHome[bestIndex] = !aAtHome[bestIndex];
    best = bestPenalty;
  }

  const firstHalf: ScheduledFixture[] = pairings.map((p, index) => ({
    round: p.round,
    homeClubId: aAtHome[index] ? p.a : p.b,
    awayClubId: aAtHome[index] ? p.b : p.a,
  }));

  const secondHalf: ScheduledFixture[] = firstHalf.map((f) => ({
    round: f.round + roundsPerHalf,
    homeClubId: f.awayClubId,
    awayClubId: f.homeClubId,
  }));

  return [...firstHalf, ...secondHalf];
}

export const ROUNDS_IN_SEASON = 38;

/**
 * Cosmetic kickoff date for a round. The season is laid out as one round per
 * week from the given start date; nothing in the simulation depends on it.
 */
export function roundDate(seasonStart: Date, round: number): Date {
  const date = new Date(seasonStart);
  date.setDate(date.getDate() + (round - 1) * 7);
  return date;
}

/** Default opening weekend for the 2025-26 season. */
export const DEFAULT_SEASON_START = new Date("2025-08-16T00:00:00.000Z");

/** The fixtures for one round, in club id order for stable display. */
export function fixturesForRound(
  fixtures: ScheduledFixture[],
  round: number,
): ScheduledFixture[] {
  return fixtures.filter((f) => f.round === round);
}
