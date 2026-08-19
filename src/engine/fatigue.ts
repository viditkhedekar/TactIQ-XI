/**
 * Condition between matches, and the injuries that come from ignoring it.
 *
 * In-match drain lives in tactics.ts next to the instructions that cause it.
 * This file covers what happens either side of a match: how much a player
 * recovers during the week, and how likely a tired or ageing player is to
 * break down. Rotation only matters if these two interact, so they do:
 * risk scales with how far below full fitness a player starts.
 */

import { FATIGUE, INJURY } from "./constants";
import { chance, randInt, randNormal, weightedIndex, type RngState } from "./rng";
import type { EnginePlayer, InjurySeverity } from "./types";

/**
 * Fitness after a week's recovery. Players who did not feature recover more,
 * which is the reward for resting someone.
 */
export function recoverFitness(current: number, played: boolean): number {
  const gap = 100 - current;
  const recovered =
    current +
    gap * FATIGUE.weeklyRecoveryShare +
    FATIGUE.weeklyRecoveryFlat +
    (played ? 0 : FATIGUE.weeklyRestBonus);
  return Math.max(0, Math.min(100, recovered));
}

/** Age multiplier on injury risk: the wrong side of thirty costs you. */
export function ageInjuryFactor(age: number): number {
  if (age <= INJURY.agePivot) return 1;
  return 1 + (age - INJURY.agePivot) * INJURY.ageWeight;
}

/**
 * Probability that a given player picks up an injury in a given minute.
 * A player at 50 fitness is roughly twice as likely to go down as a fresh one.
 */
export function injuryChancePerMinute(player: EnginePlayer, fitness: number): number {
  const tiredness = 1 - Math.max(0, Math.min(100, fitness)) / 100;
  return (
    INJURY.perMinute * (1 + tiredness * INJURY.fatigueWeight) * ageInjuryFactor(player.age)
  );
}

const SEVERITIES: InjurySeverity[] = ["knock", "minor", "moderate", "severe"];

/**
 * Rolls how bad an injury is and how many rounds it costs. A knock costs no
 * rounds: the player can stay on, carrying a fitness penalty.
 */
export function rollInjury(rng: RngState): { severity: InjurySeverity; outRounds: number } {
  const weights = SEVERITIES.map((s) => INJURY.severityWeights[s]);
  const severity = SEVERITIES[weightedIndex(rng, weights)];
  const [min, max] = INJURY.outRounds[severity];
  return { severity, outRounds: randInt(rng, min, max) };
}

/** Whether an injury forces the player off. Knocks do not. */
export function forcesSubstitution(severity: InjurySeverity): boolean {
  return severity !== "knock";
}

/**
 * Added time for a half. Real matches vary, and a flat number would make the
 * commentary feel mechanical.
 */
export function rollAddedTime(rng: RngState, range: readonly [number, number]): number {
  return randInt(rng, range[0], range[1]);
}

/**
 * Small random variation applied to a player's contribution on the day, so a
 * favourite does not simply win every time. Consistency is not in the source
 * data, so it is derived from composure: composed players vary less.
 */
export function performanceVariance(rng: RngState, composure: number): number {
  const sd = 0.1 - (Math.max(0, Math.min(100, composure)) / 100) * 0.045;
  return Math.max(0.75, Math.min(1.25, randNormal(rng, 1, sd)));
}

/** Whether a knock happens to also end the player's afternoon. */
export function knockWorsens(rng: RngState): boolean {
  return chance(rng, 0.15);
}
