/**
 * Match ratings out of ten.
 *
 * Ratings are the game's shorthand for "how did he play", so they need to
 * respond to the things a viewer would notice: goals, assists, saves, cards,
 * and whether the team was any good. They feed the season leaderboards and
 * the rolling form figure that alters a player's effectiveness in later matches.
 */

import { FORM, RATING } from "./constants";
import type { LineupPlayer } from "./types";

function clamp(rating: number): number {
  return Math.max(RATING.min, Math.min(RATING.max, rating));
}

export function adjustRating(lp: LineupPlayer, delta: number): void {
  lp.rating = clamp(lp.rating + delta);
}

export function creditGoal(scorer: LineupPlayer): void {
  scorer.goals += 1;
  scorer.shots += 1;
  adjustRating(scorer, RATING.goal);
}

export function creditAssist(assister: LineupPlayer): void {
  assister.assists += 1;
  adjustRating(assister, RATING.assist);
}

export function creditShotOnTarget(shooter: LineupPlayer): void {
  shooter.shots += 1;
  adjustRating(shooter, RATING.shotOnTarget);
}

export function creditShotOff(shooter: LineupPlayer): void {
  shooter.shots += 1;
  adjustRating(shooter, RATING.shotOff);
}

export function creditSave(keeper: LineupPlayer): void {
  keeper.saves += 1;
  adjustRating(keeper, RATING.keySave);
}

export function creditPenaltyMissed(taker: LineupPlayer): void {
  taker.shots += 1;
  adjustRating(taker, RATING.penaltyMissed);
}

export function creditYellow(lp: LineupPlayer): void {
  adjustRating(lp, RATING.yellow);
}

export function creditRed(lp: LineupPlayer): void {
  adjustRating(lp, RATING.red);
}

/**
 * A conceded goal is felt by the keeper and the back line, not by the strikers.
 */
export function creditGoalConceded(onPitch: LineupPlayer[]): void {
  for (const lp of onPitch) {
    if (lp.player.isGk) {
      adjustRating(lp, RATING.goalConceded);
    } else if (isDefensiveSlot(lp)) {
      adjustRating(lp, RATING.goalConceded * 0.6);
    }
  }
}

function isDefensiveSlot(lp: LineupPlayer): boolean {
  return (
    lp.slot.includes("CB") ||
    lp.slot === "LB" ||
    lp.slot === "RB" ||
    lp.slot === "LWB" ||
    lp.slot === "RWB" ||
    lp.slot === "CDM"
  );
}

/**
 * Nudges every player toward how the team is doing. Applied periodically so
 * that a player in a side being overrun does not sit on a flattering 6.0.
 */
export function applyTeamDrift(onPitch: LineupPlayer[], goalDifference: number): void {
  if (goalDifference === 0) return;
  const drift = Math.sign(goalDifference) * RATING.teamPerformanceDrift;
  for (const lp of onPitch) {
    if (lp.sentOff) continue;
    adjustRating(lp, drift);
  }
}

/** Clean sheet bonus for the keeper and defenders who played most of the match. */
export function applyCleanSheet(allPlayers: LineupPlayer[]): void {
  for (const lp of allPlayers) {
    if (lp.minutesPlayed < 45) continue;
    if (lp.player.isGk || isDefensiveSlot(lp)) {
      adjustRating(lp, RATING.cleanSheetDefender);
    }
  }
}

/**
 * A substitute who played twenty minutes should not carry the same weight as
 * a starter, so short cameos are pulled back toward the baseline.
 */
export function finalRating(lp: LineupPlayer): number {
  if (lp.minutesPlayed >= 60) return round1(lp.rating);
  const weight = Math.max(0.35, lp.minutesPlayed / 60);
  return round1(RATING.base + (lp.rating - RATING.base) * weight);
}

function round1(v: number): number {
  return Math.round(clamp(v) * 10) / 10;
}

/**
 * Folds a new match rating into a rolling form figure. The window is applied
 * as an exponential average rather than a stored list of past ratings: it
 * behaves the same way over a season and keeps career state to one number.
 */
export function updateForm(currentForm: number, matchRating: number): number {
  const alpha = 2 / (FORM.window + 1);
  const updated = currentForm + alpha * (matchRating - currentForm);
  return Math.round(updated * 100) / 100;
}
