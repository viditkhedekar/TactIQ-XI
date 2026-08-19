import { describe, it, expect } from "vitest";
import {
  adjustRating,
  creditGoal,
  creditAssist,
  creditShotOnTarget,
  creditSave,
  creditYellow,
  creditRed,
  creditGoalConceded,
  creditPenaltyMissed,
  applyTeamDrift,
  applyCleanSheet,
  finalRating,
  updateForm,
} from "../playerRating";
import { makePlayer, makeLineupPlayer } from "./factories";
import type { Slot } from "../types";

const lp = (slot: Slot = "CM", minutes = 90) => {
  const player = makeLineupPlayer(makePlayer({ isGk: slot === "GK" }), slot);
  player.minutesPlayed = minutes;
  return player;
};

describe("rating credits", () => {
  it("rewards a goal more than an assist, and an assist more than a shot", () => {
    const scorer = lp();
    const assister = lp();
    const shooter = lp();
    creditGoal(scorer);
    creditAssist(assister);
    creditShotOnTarget(shooter);
    expect(scorer.rating).toBeGreaterThan(assister.rating);
    expect(assister.rating).toBeGreaterThan(shooter.rating);
  });

  it("counts goals as shots", () => {
    const scorer = lp();
    creditGoal(scorer);
    expect(scorer.goals).toBe(1);
    expect(scorer.shots).toBe(1);
  });

  it("punishes cards", () => {
    const booked = lp();
    const sentOff = lp();
    creditYellow(booked);
    creditRed(sentOff);
    expect(booked.rating).toBeLessThan(6.0);
    expect(sentOff.rating).toBeLessThan(booked.rating);
  });

  it("punishes a missed penalty", () => {
    const taker = lp();
    creditPenaltyMissed(taker);
    expect(taker.rating).toBeLessThan(5.5);
  });

  it("counts saves for the keeper", () => {
    const keeper = lp("GK");
    creditSave(keeper);
    creditSave(keeper);
    expect(keeper.saves).toBe(2);
    expect(keeper.rating).toBeGreaterThan(6.0);
  });

  it("never leaves the four to ten range", () => {
    const star = lp();
    for (let i = 0; i < 20; i++) creditGoal(star);
    expect(star.rating).toBe(10.0);

    const disaster = lp();
    for (let i = 0; i < 20; i++) creditRed(disaster);
    expect(disaster.rating).toBe(4.0);
  });
});

describe("creditGoalConceded", () => {
  it("hits the keeper hardest and spares the strikers", () => {
    const keeper = lp("GK");
    const centreBack = lp("LCB");
    const striker = lp("ST");
    creditGoalConceded([keeper, centreBack, striker]);

    expect(keeper.rating).toBeLessThan(centreBack.rating);
    expect(centreBack.rating).toBeLessThan(6.0);
    expect(striker.rating).toBe(6.0);
  });
});

describe("applyTeamDrift", () => {
  it("lifts a winning side and drags a losing one", () => {
    const winner = lp();
    const loser = lp();
    applyTeamDrift([winner], 2);
    applyTeamDrift([loser], -2);
    expect(winner.rating).toBeGreaterThan(6.0);
    expect(loser.rating).toBeLessThan(6.0);
  });

  it("does nothing when level", () => {
    const player = lp();
    applyTeamDrift([player], 0);
    expect(player.rating).toBe(6.0);
  });

  it("skips players who have been sent off", () => {
    const player = lp();
    player.sentOff = true;
    applyTeamDrift([player], 3);
    expect(player.rating).toBe(6.0);
  });
});

describe("applyCleanSheet", () => {
  it("rewards defenders and the keeper only", () => {
    const keeper = lp("GK");
    const fullBack = lp("RB");
    const winger = lp("RW");
    applyCleanSheet([keeper, fullBack, winger]);

    expect(keeper.rating).toBeGreaterThan(6.0);
    expect(fullBack.rating).toBeGreaterThan(6.0);
    expect(winger.rating).toBe(6.0);
  });

  it("skips a defender who only came on late", () => {
    const lateSub = lp("LCB", 20);
    applyCleanSheet([lateSub]);
    expect(lateSub.rating).toBe(6.0);
  });
});

describe("finalRating", () => {
  it("keeps a starter's rating as earned", () => {
    const starter = lp("ST", 90);
    creditGoal(starter);
    expect(finalRating(starter)).toBe(7.0);
  });

  it("pulls a brief cameo back toward the baseline", () => {
    const cameo = lp("ST", 10);
    creditGoal(cameo);
    const full = lp("ST", 90);
    creditGoal(full);
    expect(finalRating(cameo)).toBeLessThan(finalRating(full));
    expect(finalRating(cameo)).toBeGreaterThan(6.0);
  });

  it("rounds to one decimal place", () => {
    const player = lp();
    adjustRating(player, 0.4567);
    expect(finalRating(player)).toBe(6.5);
  });

  it("stays inside the range for an unused substitute", () => {
    const unused = lp("ST", 0);
    expect(finalRating(unused)).toBe(6.0);
  });
});

describe("updateForm", () => {
  it("moves toward a good run and back down after bad games", () => {
    let form = 6.5;
    for (let i = 0; i < 5; i++) form = updateForm(form, 8.5);
    expect(form).toBeGreaterThan(7.4);

    for (let i = 0; i < 8; i++) form = updateForm(form, 5.0);
    expect(form).toBeLessThan(6.0);
  });

  it("responds gradually rather than jumping to the latest score", () => {
    const after = updateForm(6.5, 9.5);
    expect(after).toBeGreaterThan(6.5);
    expect(after).toBeLessThan(7.7);
  });

  it("converges on a steady level for consistent performances", () => {
    let form = 6.5;
    for (let i = 0; i < 40; i++) form = updateForm(form, 7.2);
    expect(form).toBeCloseTo(7.2, 1);
  });
});
