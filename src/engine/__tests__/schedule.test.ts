import { describe, it, expect } from "vitest";
import { generateSchedule, roundDate, fixturesForRound, DEFAULT_SEASON_START } from "../schedule";
import { createRng } from "../rng";

const twentyClubs = Array.from({ length: 20 }, (_, i) => i + 1);

describe("generateSchedule", () => {
  it("produces 38 rounds of 10 fixtures for 20 clubs", () => {
    const fixtures = generateSchedule(twentyClubs, createRng(1));
    expect(fixtures).toHaveLength(380);

    for (let round = 1; round <= 38; round++) {
      expect(fixturesForRound(fixtures, round)).toHaveLength(10);
    }
  });

  it("has every club playing exactly once per round", () => {
    const fixtures = generateSchedule(twentyClubs, createRng(2));
    for (let round = 1; round <= 38; round++) {
      const playing = fixturesForRound(fixtures, round).flatMap((f) => [
        f.homeClubId,
        f.awayClubId,
      ]);
      expect(playing).toHaveLength(20);
      expect(new Set(playing).size).toBe(20);
    }
  });

  it("gives every club 19 home and 19 away fixtures", () => {
    const fixtures = generateSchedule(twentyClubs, createRng(3));
    for (const club of twentyClubs) {
      expect(fixtures.filter((f) => f.homeClubId === club)).toHaveLength(19);
      expect(fixtures.filter((f) => f.awayClubId === club)).toHaveLength(19);
    }
  });

  it("pairs every club with every other club exactly twice, once each way", () => {
    const fixtures = generateSchedule(twentyClubs, createRng(4));
    const pairs = new Map<string, number>();

    for (const f of fixtures) {
      const key = `${f.homeClubId}v${f.awayClubId}`;
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
    }

    for (const a of twentyClubs) {
      for (const b of twentyClubs) {
        if (a === b) continue;
        expect(pairs.get(`${a}v${b}`)).toBe(1);
      }
    }
    // No club is ever scheduled against itself.
    expect(fixtures.some((f) => f.homeClubId === f.awayClubId)).toBe(false);
  });

  it("never gives a club more than three consecutive home or away fixtures", () => {
    // Long identical runs are a classic symptom of a broken circle method.
    const fixtures = generateSchedule(twentyClubs, createRng(5));

    for (const club of twentyClubs) {
      const venues = Array.from({ length: 38 }, (_, i) => {
        const f = fixturesForRound(fixtures, i + 1).find(
          (x) => x.homeClubId === club || x.awayClubId === club,
        )!;
        return f.homeClubId === club ? "H" : "A";
      });

      let run = 1;
      let longest = 1;
      for (let i = 1; i < venues.length; i++) {
        run = venues[i] === venues[i - 1] ? run + 1 : 1;
        longest = Math.max(longest, run);
      }
      expect(longest).toBeLessThanOrEqual(3);
    }
  });

  it("produces the same schedule for the same seed and a different one otherwise", () => {
    const a = generateSchedule(twentyClubs, createRng(42));
    const b = generateSchedule(twentyClubs, createRng(42));
    const c = generateSchedule(twentyClubs, createRng(43));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("works for a smaller even league", () => {
    const fixtures = generateSchedule([1, 2, 3, 4], createRng(6));
    expect(fixtures).toHaveLength(12);
    for (let round = 1; round <= 6; round++) {
      expect(fixturesForRound(fixtures, round)).toHaveLength(2);
    }
  });

  it("rejects an odd number of clubs rather than dropping one", () => {
    expect(() => generateSchedule([1, 2, 3], createRng(7))).toThrow(/even/);
  });

  it("returns nothing for a league too small to play", () => {
    expect(generateSchedule([1], createRng(8))).toEqual([]);
    expect(generateSchedule([], createRng(8))).toEqual([]);
  });
});

describe("roundDate", () => {
  it("advances one week per round from the season start", () => {
    const first = roundDate(DEFAULT_SEASON_START, 1);
    const second = roundDate(DEFAULT_SEASON_START, 2);
    expect(first.toISOString().slice(0, 10)).toBe("2025-08-16");
    expect((second.getTime() - first.getTime()) / 86_400_000).toBe(7);
  });

  it("does not mutate the season start", () => {
    const start = new Date(DEFAULT_SEASON_START);
    roundDate(start, 20);
    expect(start.getTime()).toBe(DEFAULT_SEASON_START.getTime());
  });
});
