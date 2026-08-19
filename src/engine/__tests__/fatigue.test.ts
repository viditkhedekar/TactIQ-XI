import { describe, it, expect } from "vitest";
import {
  recoverFitness,
  ageInjuryFactor,
  injuryChancePerMinute,
  rollInjury,
  forcesSubstitution,
  rollAddedTime,
  performanceVariance,
} from "../fatigue";
import { createRng } from "../rng";
import { fatigueDrain, DEFAULT_TACTICS } from "../tactics";
import { makePlayer } from "./factories";
import type { TeamTactics } from "../types";

describe("recoverFitness", () => {
  it("recovers most of the gap in a week", () => {
    expect(recoverFitness(60, true)).toBeGreaterThan(80);
    expect(recoverFitness(60, true)).toBeLessThanOrEqual(100);
  });

  it("recovers more when rested", () => {
    expect(recoverFitness(60, false)).toBeGreaterThan(recoverFitness(60, true));
  });

  it("never exceeds full fitness", () => {
    expect(recoverFitness(98, false)).toBe(100);
    expect(recoverFitness(100, false)).toBe(100);
  });

  it("does not fully restore an exhausted player in one week", () => {
    expect(recoverFitness(30, true)).toBeLessThan(100);
  });

  it("compounds across a congested run without rotation", () => {
    // Play a full match every week at high tempo and press: fitness should
    // settle at a visibly reduced level rather than bouncing back to 100.
    const tactics: TeamTactics = { ...DEFAULT_TACTICS, tempo: 5, pressing: 5 };
    let fitness = 100;
    for (let round = 0; round < 15; round++) {
      fitness = Math.max(0, fitness - fatigueDrain("LCM", 70, tactics) * 90);
      fitness = recoverFitness(fitness, true);
    }
    expect(fitness).toBeLessThan(92);
    expect(fitness).toBeGreaterThan(40);
  });

  it("keeps a rested player near full fitness over the same run", () => {
    let fitness = 100;
    for (let round = 0; round < 15; round++) fitness = recoverFitness(fitness, false);
    expect(fitness).toBe(100);
  });
});

describe("injury risk", () => {
  it("is neutral for a young player and rises with age", () => {
    expect(ageInjuryFactor(24)).toBe(1);
    expect(ageInjuryFactor(29)).toBe(1);
    expect(ageInjuryFactor(35)).toBeGreaterThan(1.1);
  });

  it("roughly doubles for an exhausted player", () => {
    const p = makePlayer({ age: 26 });
    const fresh = injuryChancePerMinute(p, 100);
    const spent = injuryChancePerMinute(p, 20);
    expect(spent / fresh).toBeGreaterThan(1.5);
    expect(spent / fresh).toBeLessThan(3.5);
  });

  it("produces a believable number of injuries across a match", () => {
    // 22 players over 90 minutes should average well under one injury per game.
    const p = makePlayer({ age: 27 });
    const expected = injuryChancePerMinute(p, 80) * 90 * 22;
    expect(expected).toBeGreaterThan(0.15);
    expect(expected).toBeLessThan(0.9);
  });
});

describe("rollInjury", () => {
  it("returns a knock with no rounds out most of the time", () => {
    const rng = createRng(2024);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 20_000; i++) {
      const { severity, outRounds } = rollInjury(rng);
      counts[severity] = (counts[severity] ?? 0) + 1;
      if (severity === "knock") expect(outRounds).toBe(0);
      else expect(outRounds).toBeGreaterThan(0);
    }
    expect(counts.knock / 20_000).toBeGreaterThan(0.5);
    expect(counts.severe / 20_000).toBeLessThan(0.06);
  });

  it("keeps every severity inside its configured range", () => {
    const rng = createRng(7);
    const bounds = { knock: [0, 0], minor: [1, 2], moderate: [3, 6], severe: [8, 16] };
    for (let i = 0; i < 5000; i++) {
      const { severity, outRounds } = rollInjury(rng);
      const [min, max] = bounds[severity];
      expect(outRounds).toBeGreaterThanOrEqual(min);
      expect(outRounds).toBeLessThanOrEqual(max);
    }
  });

  it("only forces a substitution for real injuries", () => {
    expect(forcesSubstitution("knock")).toBe(false);
    expect(forcesSubstitution("minor")).toBe(true);
    expect(forcesSubstitution("severe")).toBe(true);
  });
});

describe("rollAddedTime", () => {
  it("stays inside the requested range", () => {
    const rng = createRng(5);
    for (let i = 0; i < 500; i++) {
      const v = rollAddedTime(rng, [2, 6]);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(6);
    }
  });
});

describe("performanceVariance", () => {
  it("centres on neutral", () => {
    const rng = createRng(13);
    let sum = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) sum += performanceVariance(rng, 70);
    expect(sum / n).toBeGreaterThan(0.98);
    expect(sum / n).toBeLessThan(1.02);
  });

  it("varies less for composed players", () => {
    const rng = createRng(21);
    const spread = (composure: number) => {
      let min = 2;
      let max = 0;
      for (let i = 0; i < 5000; i++) {
        const v = performanceVariance(rng, composure);
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
      return max - min;
    };
    expect(spread(95)).toBeLessThan(spread(30));
  });

  it("stays within sane bounds", () => {
    const rng = createRng(99);
    for (let i = 0; i < 10_000; i++) {
      const v = performanceVariance(rng, 20);
      expect(v).toBeGreaterThanOrEqual(0.75);
      expect(v).toBeLessThanOrEqual(1.25);
    }
  });
});
