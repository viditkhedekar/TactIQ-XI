/**
 * Turning one season into the next.
 *
 * Three things happen in a summer: everybody gets a year older and moves
 * towards or away from their potential, the bottom three go down and three
 * come up, and the board resets its expectations against the division as it
 * now stands.
 *
 * Ageing is the part worth being careful about. It is deliberately not the same
 * curve as weekly training: a season's worth of growth applied in one step
 * would let a nineteen-year-old jump ten points in an afternoon. Instead the
 * summer step is small and the real development still happens week by week
 * through training. What the summer does is the thing training cannot: move a
 * player's age, and with it which side of the curve he is on.
 */

import { chance, randNormal, shuffle, type RngState } from "./rng";
import type { EnginePlayer } from "./types";
import type { TrainableAttribute } from "./training";

export const ROLLOVER = {
  /** Clubs relegated, and therefore promoted, each summer. */
  relegated: 3,

  /**
   * Retirement is off by design, and the ages below are the safety net rather
   * than the rule.
   *
   * Squads persist from season to season, and nothing replaces a player who
   * leaves: there is no youth intake and no regeneration. Retiring the usual
   * two or three veterans a summer would therefore not create turnover, it
   * would quietly shrink every squad in the game until clubs could not name
   * eleven. So players only retire at an age nobody reaches in a normal save,
   * which keeps the fiction sane without draining anybody.
   *
   * If a youth intake is ever added, `retirementAge` is the number to bring
   * back down to about 34.
   */
  retirementAge: 40,
  /** Chance of retiring, per year past `retirementAge`. */
  retirementChancePerYear: 0.35,
  /** Everybody is gone by here, whatever the dice say. */
  forcedRetirementAge: 44,

  /**
   * The summer step, in rating points.
   *
   * Small on purpose: this is the settling that happens between seasons, not a
   * season's development. A promising 19-year-old gains a point or two; a
   * 33-year-old loses one.
   */
  youngGain: { maxAge: 21, mean: 1.4, sd: 0.7 },
  primeGain: { maxAge: 27, mean: 0.4, sd: 0.6 },
  declineStart: 30,
  declinePerYear: 0.42,

  /** Physical attributes are what actually goes as a player ages. */
  physicalAttributes: [
    "acceleration",
    "sprintSpeed",
    "agility",
    "stamina",
    "jumping",
    "balance",
  ] as const satisfies readonly TrainableAttribute[],

  /** Mental attributes that quietly improve with the years. */
  mentalAttributes: [
    "composure",
    "vision",
    "positioning",
    "interceptions",
  ] as const satisfies readonly TrainableAttribute[],
} as const;

export type AgeingResult = {
  playerId: number;
  /** New age. */
  age: number;
  /** Movement to fold into the career's stored attribute deltas. */
  deltas: Partial<Record<TrainableAttribute, number>>;
  retired: boolean;
};

/**
 * A player's summer.
 *
 * `headroom` against potential gates the gain exactly as weekly training does,
 * so a player who has already reached his ceiling stops climbing rather than
 * drifting past it every August.
 */
export function ageOneSummer(
  rng: RngState,
  player: EnginePlayer,
  potential: number,
): AgeingResult {
  const age = player.age + 1;

  const retired =
    age >= ROLLOVER.forcedRetirementAge ||
    (age > ROLLOVER.retirementAge &&
      chance(rng, (age - ROLLOVER.retirementAge) * ROLLOVER.retirementChancePerYear));

  if (retired) {
    return { playerId: player.id, age, deltas: {}, retired: true };
  }

  const deltas: Partial<Record<TrainableAttribute, number>> = {};
  const headroom = Math.max(0, potential - player.overall);

  if (age <= ROLLOVER.youngGain.maxAge) {
    // The young improve, but only into whatever room their potential leaves.
    const gain =
      Math.max(0, randNormal(rng, ROLLOVER.youngGain.mean, ROLLOVER.youngGain.sd)) *
      Math.min(1, headroom / 6);
    for (const attribute of ROLLOVER.mentalAttributes) deltas[attribute] = gain;
    for (const attribute of ROLLOVER.physicalAttributes) deltas[attribute] = gain * 0.6;
  } else if (age <= ROLLOVER.primeGain.maxAge) {
    const gain =
      Math.max(0, randNormal(rng, ROLLOVER.primeGain.mean, ROLLOVER.primeGain.sd)) *
      Math.min(1, headroom / 4);
    for (const attribute of ROLLOVER.mentalAttributes) deltas[attribute] = gain;
  }

  if (age >= ROLLOVER.declineStart) {
    // Legs go first, and faster every year. What a veteran keeps is his head,
    // which is why the mental attributes still tick up while the physical fall.
    const years = age - ROLLOVER.declineStart + 1;
    const loss = ROLLOVER.declinePerYear * years;
    for (const attribute of ROLLOVER.physicalAttributes) {
      deltas[attribute] = (deltas[attribute] ?? 0) - loss;
    }
    for (const attribute of ROLLOVER.mentalAttributes) {
      deltas[attribute] = (deltas[attribute] ?? 0) + loss * 0.15;
    }
  }

  return { playerId: player.id, age, deltas, retired: false };
}

/* --------------------------------------------------------- up and down */

export type TableStanding = { clubId: number; position: number };

export type PromotionResult = {
  relegated: number[];
  promoted: number[];
  /** The new twenty, in no particular order. */
  division: number[];
};

/**
 * Works out who goes down and who comes up.
 *
 * The promoted three are drawn from whichever second-tier clubs are not
 * currently in the division, so a club relegated one season can come straight
 * back the next. That is both realistic and necessary: without it the pool
 * would drain after a few seasons.
 */
export function applyPromotionAndRelegation(
  rng: RngState,
  standings: TableStanding[],
  secondTierPool: number[],
): PromotionResult {
  const ordered = [...standings].sort((a, b) => a.position - b.position);
  const relegated = ordered.slice(-ROLLOVER.relegated).map((s) => s.clubId);
  const staying = ordered.slice(0, -ROLLOVER.relegated).map((s) => s.clubId);

  // Anybody in the second tier who is not already in the division. The
  // relegated three are eligible immediately, which is how a club bounces.
  const eligible = secondTierPool.filter((id) => !staying.includes(id));

  // Shuffling and taking the first three is the same as drawing three without
  // replacement, and keeps the draw deterministic for a given seed.
  const promoted = shuffle(rng, eligible).slice(0, ROLLOVER.relegated);

  return { relegated, promoted, division: [...staying, ...promoted] };
}
