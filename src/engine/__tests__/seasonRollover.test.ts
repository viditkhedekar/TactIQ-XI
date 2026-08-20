import { describe, expect, it } from "vitest";
import { createRng } from "../rng";
import {
  ROLLOVER,
  ageOneSummer,
  applyPromotionAndRelegation,
  type TableStanding,
} from "../seasonRollover";
import { CUP, cupRoundForLeagueRound, drawRound, penaltyShootout, selectEntrants } from "../cup";
import type { EnginePlayer } from "../types";

/** A plain outfielder to age. Only the fields the rollover reads matter. */
function player(overrides: Partial<EnginePlayer> = {}): EnginePlayer {
  return {
    id: 1,
    name: "Test",
    clubId: 1,
    positions: ["CM"],
    isGk: false,
    overall: 70,
    age: 24,
    fitness: 100,
    form: 6.5,
    ...overrides,
  } as EnginePlayer;
}

describe("ageing", () => {
  it("adds exactly one year", () => {
    const result = ageOneSummer(createRng(1), player({ age: 24 }), 80);
    expect(result.age).toBe(25);
  });

  it("improves a young player with room to grow", () => {
    const result = ageOneSummer(createRng(7), player({ age: 19, overall: 65 }), 85);
    const total = Object.values(result.deltas).reduce((s, v) => s + (v ?? 0), 0);
    expect(total).toBeGreaterThan(0);
  });

  it("does not improve a young player already at his ceiling", () => {
    const atCeiling = ageOneSummer(createRng(7), player({ age: 19, overall: 85 }), 85);
    const withRoom = ageOneSummer(createRng(7), player({ age: 19, overall: 65 }), 85);

    const sum = (d: Record<string, number | undefined>) =>
      Object.values(d).reduce((s: number, v) => s + (v ?? 0), 0);

    expect(sum(atCeiling.deltas)).toBeLessThan(sum(withRoom.deltas));
  });

  it("takes pace off a player past thirty", () => {
    const result = ageOneSummer(createRng(3), player({ age: 33, overall: 78 }), 78);
    expect(result.deltas.sprintSpeed ?? 0).toBeLessThan(0);
    expect(result.deltas.acceleration ?? 0).toBeLessThan(0);
  });

  it("declines harder the older the player is", () => {
    const sum = (age: number) => {
      const d = ageOneSummer(createRng(5), player({ age, overall: 78 }), 78).deltas;
      return d.sprintSpeed ?? 0;
    };
    expect(sum(36)).toBeLessThan(sum(31));
  });

  it("still adds to a veteran's head as his legs go", () => {
    // Past the decline age but not old enough to retire, or there would be no
    // deltas at all to inspect.
    const result = ageOneSummer(createRng(9), player({ age: 31, overall: 78 }), 78);
    expect(result.deltas.composure ?? 0).toBeGreaterThan(0);
    expect(result.deltas.sprintSpeed ?? 0).toBeLessThan(0);
  });

  it("never retires a player in his twenties", () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const result = ageOneSummer(createRng(seed), player({ age: 25 }), 80);
      expect(result.retired).toBe(false);
    }
  });

  it("always retires a player who reaches the hard limit", () => {
    const result = ageOneSummer(
      createRng(1),
      player({ age: ROLLOVER.forcedRetirementAge - 1 }),
      70,
    );
    expect(result.retired).toBe(true);
  });

  it("retires some but not all of a cohort of veterans", () => {
    let retired = 0;
    for (let seed = 0; seed < 100; seed += 1) {
      if (ageOneSummer(createRng(seed), player({ age: 35 }), 70).retired) retired += 1;
    }
    expect(retired).toBeGreaterThan(0);
    expect(retired).toBeLessThan(100);
  });

  it("is deterministic for a given seed", () => {
    const a = ageOneSummer(createRng(42), player({ age: 30 }), 80);
    const b = ageOneSummer(createRng(42), player({ age: 30 }), 80);
    expect(a).toEqual(b);
  });
});

describe("promotion and relegation", () => {
  const standings: TableStanding[] = Array.from({ length: 20 }, (_, i) => ({
    clubId: 100 + i,
    position: i + 1,
  }));
  const pool = [900, 901, 902, 903, 904, 905];

  it("relegates exactly the bottom three", () => {
    const result = applyPromotionAndRelegation(createRng(1), standings, pool);
    expect(result.relegated).toEqual([117, 118, 119]);
  });

  it("promotes exactly three", () => {
    const result = applyPromotionAndRelegation(createRng(1), standings, pool);
    expect(result.promoted).toHaveLength(3);
  });

  it("keeps the division at twenty", () => {
    const result = applyPromotionAndRelegation(createRng(1), standings, pool);
    expect(result.division).toHaveLength(20);
  });

  it("never promotes a club already staying up", () => {
    const result = applyPromotionAndRelegation(createRng(4), standings, pool);
    const staying = standings.slice(0, 17).map((s) => s.clubId);
    for (const id of result.promoted) expect(staying).not.toContain(id);
  });

  it("lets a relegated club come straight back", () => {
    // With a pool containing only the three just relegated, they must return.
    const result = applyPromotionAndRelegation(createRng(2), standings, [117, 118, 119]);
    expect(result.promoted.sort()).toEqual([117, 118, 119]);
  });

  it("produces no duplicates in the new division", () => {
    const result = applyPromotionAndRelegation(createRng(8), standings, pool);
    expect(new Set(result.division).size).toBe(result.division.length);
  });

  it("varies the draw with the seed", () => {
    const a = applyPromotionAndRelegation(createRng(1), standings, pool).promoted;
    const b = applyPromotionAndRelegation(createRng(99), standings, pool).promoted;
    expect(a).not.toEqual(b);
  });
});

describe("the cup", () => {
  const division = Array.from({ length: 20 }, (_, i) => 100 + i);
  const lower = Array.from({ length: 16 }, (_, i) => 900 + i);

  it("fills a bracket that is a power of two", () => {
    const entrants = selectEntrants(createRng(1), division, lower);
    expect(Math.log2(entrants.length) % 1).toBe(0);
    expect(entrants.length).toBe(CUP.entrants);
  });

  it("includes every club from the division", () => {
    const entrants = selectEntrants(createRng(1), division, lower);
    for (const id of division) expect(entrants).toContain(id);
  });

  it("pairs everybody exactly once", () => {
    const ties = drawRound(createRng(1), Array.from({ length: 32 }, (_, i) => i), 1);
    expect(ties).toHaveLength(16);
    const seen = ties.flatMap((t) => [t.homeClubId, t.awayClubId]);
    expect(new Set(seen).size).toBe(32);
  });

  it("schedules a cup round in the rounds it says it does", () => {
    expect(cupRoundForLeagueRound(CUP.roundSchedule[0])).toBe(1);
    expect(cupRoundForLeagueRound(CUP.roundSchedule[4])).toBe(5);
    expect(cupRoundForLeagueRound(2)).toBeNull();
  });

  it("always separates the sides in a shootout", () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const result = penaltyShootout(
        createRng(seed),
        { clubId: 1, strength: 80 },
        { clubId: 2, strength: 60 },
      );
      expect([1, 2]).toContain(result.winnerClubId);
      expect(result.homeScore).not.toBe(result.awayScore);
    }
  });

  it("lets the weaker side win a shootout often enough to matter", () => {
    let underdogWins = 0;
    for (let seed = 0; seed < 200; seed += 1) {
      const result = penaltyShootout(
        createRng(seed),
        { clubId: 1, strength: 85 },
        { clubId: 2, strength: 55 },
      );
      if (result.winnerClubId === 2) underdogWins += 1;
    }
    // A shootout is close to a coin flip, so the underdog must win a good share.
    expect(underdogWins).toBeGreaterThan(50);
  });
});
