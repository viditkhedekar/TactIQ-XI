import { describe, it, expect } from "vitest";
import {
  positionFit,
  fitnessMultiplier,
  formMultiplier,
  effectiveness,
  computeTeamRatings,
  squadStrength,
  playerPace,
  finishingScore,
} from "../ratings";
import { makePlayer, makeLineupPlayer, makeSide } from "./factories";

describe("positionFit", () => {
  it("gives a natural fit for a player in their own position", () => {
    const cb = makePlayer({ positions: ["CB"] });
    expect(positionFit(cb, "LCB")).toBe(1.0);
    expect(positionFit(cb, "CB")).toBe(1.0);
  });

  it("penalises an adjacent position without ruining the player", () => {
    const cm = makePlayer({ positions: ["CM"] });
    const fit = positionFit(cm, "CDM");
    expect(fit).toBeGreaterThan(0.85);
    expect(fit).toBeLessThan(1.0);
  });

  it("penalises playing a winger on the wrong flank", () => {
    const lw = makePlayer({ positions: ["LW"] });
    expect(positionFit(lw, "RW")).toBeLessThan(positionFit(lw, "LW"));
  });

  it("wrecks a keeper played outfield and an outfielder in goal", () => {
    const gk = makePlayer({ isGk: true, positions: ["GK"] });
    const st = makePlayer({ positions: ["ST"] });
    expect(positionFit(gk, "ST")).toBe(0.3);
    expect(positionFit(st, "GK")).toBe(0.3);
  });

  it("falls back to a poor fit for an unlisted pairing", () => {
    const st = makePlayer({ positions: ["ST"] });
    expect(positionFit(st, "LCB")).toBe(0.7);
  });

  it("uses the best of a multi-position player's options", () => {
    const utility = makePlayer({ positions: ["ST", "CB"] });
    expect(positionFit(utility, "CB")).toBe(1.0);
    expect(positionFit(utility, "ST")).toBe(1.0);
  });
});

describe("fitnessMultiplier", () => {
  it("is neutral when fresh and never below the floor", () => {
    expect(fitnessMultiplier(100)).toBe(1.0);
    expect(fitnessMultiplier(95)).toBe(1.0);
    expect(fitnessMultiplier(0)).toBeCloseTo(0.7, 5);
  });

  it("decreases monotonically as a player tires", () => {
    let previous = fitnessMultiplier(100);
    for (let f = 95; f >= 0; f -= 5) {
      const current = fitnessMultiplier(f);
      expect(current).toBeLessThanOrEqual(previous);
      previous = current;
    }
  });

  it("clamps nonsense input", () => {
    expect(fitnessMultiplier(140)).toBe(1.0);
    expect(fitnessMultiplier(-20)).toBeCloseTo(0.7, 5);
  });

  it("costs a visible amount by the end of a hard match", () => {
    // A player down at 55 fitness should be measurably worse, not marginally.
    expect(fitnessMultiplier(55)).toBeLessThan(0.9);
  });
});

describe("formMultiplier", () => {
  it("swings a few percent either side of neutral", () => {
    expect(formMultiplier(6.5)).toBeGreaterThan(0.99);
    expect(formMultiplier(6.5)).toBeLessThan(1.01);
    expect(formMultiplier(8.5)).toBeGreaterThan(formMultiplier(4.5));
  });

  it("clamps beyond the configured range", () => {
    expect(formMultiplier(12)).toBe(formMultiplier(8.5));
    expect(formMultiplier(1)).toBe(formMultiplier(4.5));
  });
});

describe("effectiveness", () => {
  it("is neutral for a fresh player in their natural slot", () => {
    const lp = makeLineupPlayer(makePlayer({ positions: ["CM"] }), "CM");
    expect(effectiveness(lp)).toBeCloseTo(1.0, 1);
  });

  it("drops to zero once a player is sent off", () => {
    const lp = makeLineupPlayer(makePlayer({ positions: ["CM"] }), "CM");
    lp.sentOff = true;
    expect(effectiveness(lp)).toBe(0);
  });

  it("compounds tiredness and a bad position", () => {
    const lp = makeLineupPlayer(makePlayer({ positions: ["ST"] }), "LCB");
    lp.fitness = 50;
    expect(effectiveness(lp)).toBeLessThan(0.65);
  });
});

describe("computeTeamRatings", () => {
  it("rates a better squad higher across every unit", () => {
    const good = computeTeamRatings(makeSide({ level: 85 }));
    const poor = computeTeamRatings(makeSide({ level: 60 }));
    expect(good.midfield).toBeGreaterThan(poor.midfield);
    expect(good.attackCentral).toBeGreaterThan(poor.attackCentral);
    expect(good.defence).toBeGreaterThan(poor.defence);
    expect(good.goalkeeping).toBeGreaterThan(poor.goalkeeping);
  });

  it("tracks the attribute level closely for a naturally picked side", () => {
    const ratings = computeTeamRatings(makeSide({ level: 75 }));
    expect(ratings.midfield).toBeGreaterThan(68);
    expect(ratings.midfield).toBeLessThan(80);
  });

  it("weakens the side when a player is sent off", () => {
    const side = makeSide({ level: 75 });
    const before = computeTeamRatings(side);
    side.onPitch.find((lp) => lp.slot === "LCB")!.sentOff = true;
    const after = computeTeamRatings(side);
    expect(after.defence).toBeLessThan(before.defence);
    expect(after.midfield).toBeLessThan(before.midfield);
  });

  it("weakens the side as players tire", () => {
    const side = makeSide({ level: 75 });
    const fresh = computeTeamRatings(side);
    for (const lp of side.onPitch) lp.fitness = 50;
    const tired = computeTeamRatings(side);
    expect(tired.midfield).toBeLessThan(fresh.midfield);
    expect(tired.attackCentral).toBeLessThan(fresh.attackCentral);
  });

  it("applies a small away penalty", () => {
    const home = computeTeamRatings(makeSide({ level: 75, isHome: true }));
    const away = computeTeamRatings(makeSide({ level: 75, isHome: false }));
    expect(away.midfield).toBeLessThan(home.midfield);
    expect(away.midfield).toBeGreaterThan(home.midfield * 0.97);
  });

  it("falls back to a poor keeper rating when nobody is in goal", () => {
    const side = makeSide({ level: 85 });
    side.onPitch.find((lp) => lp.slot === "GK")!.sentOff = true;
    expect(computeTeamRatings(side).goalkeeping).toBeLessThan(50);
  });

  it("reads the back line's pace for the defensive line", () => {
    const quick = makeSide({ level: 70 });
    for (const lp of quick.onPitch) {
      if (lp.slot.includes("CB")) {
        lp.player.acceleration = 90;
        lp.player.sprintSpeed = 90;
      }
    }
    const slow = makeSide({ level: 70 });
    for (const lp of slow.onPitch) {
      if (lp.slot.includes("CB")) {
        lp.player.acceleration = 45;
        lp.player.sprintSpeed = 45;
      }
    }
    expect(computeTeamRatings(quick).defLinePace).toBeGreaterThan(
      computeTeamRatings(slow).defLinePace,
    );
  });

  it("excludes the keeper from outfield units", () => {
    // A world-class keeper must not inflate the midfield rating.
    const side = makeSide({ level: 60 });
    const before = computeTeamRatings(side).midfield;
    const gk = side.onPitch.find((lp) => lp.slot === "GK")!;
    gk.player.shortPassing = 99;
    gk.player.vision = 99;
    expect(computeTeamRatings(side).midfield).toBe(before);
  });
});

describe("squadStrength", () => {
  it("reflects the best players rather than the fringe", () => {
    const stars = Array.from({ length: 16 }, () => makePlayer({ overall: 85 }));
    const fringe = Array.from({ length: 14 }, () => makePlayer({ overall: 50 }));
    expect(squadStrength([...stars, ...fringe])).toBeGreaterThan(80);
  });

  it("handles an empty squad without dividing by zero", () => {
    expect(squadStrength([])).toBe(50);
  });
});

describe("player scores", () => {
  it("averages acceleration and sprint speed for pace", () => {
    expect(playerPace(makePlayer({ acceleration: 80, sprintSpeed: 60 }))).toBe(70);
  });

  it("uses heading for headers and long shots for range", () => {
    const header = makePlayer({ headingAccuracy: 90, finishing: 40, jumping: 90, positioning: 70 });
    expect(finishingScore(header, "header")).toBeGreaterThan(finishingScore(header, "shot"));

    const shooter = makePlayer({ longShots: 90, shotPower: 90, finishing: 40, composure: 60 });
    expect(finishingScore(shooter, "long")).toBeGreaterThan(finishingScore(shooter, "shot"));
  });

  it("uses the penalty attribute from the spot", () => {
    const specialist = makePlayer({ penalties: 95, finishing: 50, composure: 80 });
    expect(finishingScore(specialist, "penalty")).toBeGreaterThan(
      finishingScore(specialist, "shot"),
    );
  });
});
