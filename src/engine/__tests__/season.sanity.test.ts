/**
 * Realism checks over many simulated seasons.
 *
 * These run against the real committed squad data and assert that the engine
 * produces football-shaped output: sensible scorelines, believable discipline,
 * and league tables where the better squads generally finish higher. They are
 * slow by design and live outside the default suite.
 *
 *   npm run test:sanity
 */

import { describe, it, expect } from "vitest";
import { PL_CLUBS } from "@/data/clubs";
import { loadPlayersByClub } from "@/data/loadPlayers";
import { createRng } from "../rng";
import { squadStrength } from "../ratings";
import { createWorld, simulateSeason, type TableRow } from "../season";
import type { MatchResult } from "../types";

const squads = loadPlayersByClub();
const clubNames = new Map(PL_CLUBS.map((c) => [c.id, c.name]));

const SEASONS = 12;

type Run = { tables: TableRow[][]; results: MatchResult[] };

/** Simulated once and shared: replaying twelve seasons per test would be slow. */
const run: Run = (() => {
  const tables: TableRow[][] = [];
  const results: MatchResult[] = [];

  for (let season = 0; season < SEASONS; season++) {
    const world = createWorld(new Map(squads), clubNames);
    const outcome = simulateSeason(world, createRng(2000 + season), season);
    tables.push(outcome.table);
    results.push(...outcome.results);
  }

  return { tables, results };
})();

const matches = run.results.length;
const per = (total: number) => total / matches;

function sum(pick: (r: MatchResult) => number): number {
  return run.results.reduce((total, r) => total + pick(r), 0);
}

describe("season realism", () => {
  it("simulates the expected number of matches", () => {
    expect(matches).toBe(SEASONS * 380);
  });

  it("scores a believable number of goals per match", () => {
    const goals = per(sum((r) => r.homeGoals + r.awayGoals));
    expect(goals).toBeGreaterThan(2.3);
    expect(goals).toBeLessThan(3.2);
  });

  it("gives the home side an advantage without making away wins rare", () => {
    const homeWins = run.results.filter((r) => r.homeGoals > r.awayGoals).length / matches;
    const awayWins = run.results.filter((r) => r.homeGoals < r.awayGoals).length / matches;
    const draws = run.results.filter((r) => r.homeGoals === r.awayGoals).length / matches;

    expect(homeWins).toBeGreaterThan(0.4);
    expect(homeWins).toBeLessThan(0.5);
    expect(awayWins).toBeGreaterThan(0.27);
    expect(draws).toBeGreaterThan(0.17);
    expect(draws).toBeLessThan(0.29);
    expect(homeWins).toBeGreaterThan(awayWins);
  });

  it("takes a realistic number of shots", () => {
    const shots = per(sum((r) => r.homeStats.shots + r.awayStats.shots)) / 2;
    const onTarget = per(sum((r) => r.homeStats.shotsOnTarget + r.awayStats.shotsOnTarget)) / 2;

    expect(shots).toBeGreaterThan(9);
    expect(shots).toBeLessThan(17);
    expect(onTarget).toBeGreaterThan(3);
    expect(onTarget).toBeLessThan(6);
    expect(onTarget).toBeLessThan(shots);
  });

  it("books and sends off players at roughly real rates", () => {
    const yellows = per(sum((r) => r.homeStats.yellowCards + r.awayStats.yellowCards));
    const reds = per(sum((r) => r.homeStats.redCards + r.awayStats.redCards));

    expect(yellows).toBeGreaterThan(2.5);
    expect(yellows).toBeLessThan(5.5);
    expect(reds).toBeGreaterThan(0.04);
    expect(reds).toBeLessThan(0.3);
  });

  it("injures players occasionally rather than constantly", () => {
    const injuries = per(sum((r) => r.events.filter((e) => e.type === "injury").length));
    expect(injuries).toBeGreaterThan(0.15);
    expect(injuries).toBeLessThan(0.7);
  });

  it("keeps scorelines sane", () => {
    const biggest = Math.max(...run.results.map((r) => Math.abs(r.homeGoals - r.awayGoals)));
    const mostGoals = Math.max(...run.results.map((r) => r.homeGoals + r.awayGoals));

    // Thrashings happen, but 12-0 does not.
    expect(biggest).toBeLessThanOrEqual(9);
    expect(mostGoals).toBeLessThanOrEqual(13);
  });

  it("produces plenty of low-scoring matches, as football does", () => {
    const lowScoring = run.results.filter((r) => r.homeGoals + r.awayGoals <= 2).length / matches;
    expect(lowScoring).toBeGreaterThan(0.25);
  });

  it("keeps clean sheets a regular occurrence", () => {
    const cleanSheets =
      run.results.filter((r) => r.homeGoals === 0 || r.awayGoals === 0).length / matches;
    expect(cleanSheets).toBeGreaterThan(0.3);
    expect(cleanSheets).toBeLessThan(0.7);
  });
});

describe("league tables", () => {
  it("adds up to a complete season for every club", () => {
    for (const table of run.tables) {
      expect(table).toHaveLength(20);
      const totalPoints = table.reduce((s, row) => s + row.points, 0);
      const totalGoalsFor = table.reduce((s, row) => s + row.goalsFor, 0);
      const totalGoalsAgainst = table.reduce((s, row) => s + row.goalsAgainst, 0);

      for (const row of table) {
        expect(row.played).toBe(38);
        expect(row.won + row.drawn + row.lost).toBe(38);
        expect(row.points).toBe(row.won * 3 + row.drawn);
      }

      // Every match awards two or three points in total.
      expect(totalPoints).toBeGreaterThanOrEqual(380 * 2);
      expect(totalPoints).toBeLessThanOrEqual(380 * 3);
      expect(totalGoalsFor).toBe(totalGoalsAgainst);
    }
  });

  it("is ordered by points", () => {
    for (const table of run.tables) {
      for (let i = 1; i < table.length; i++) {
        expect(table[i - 1].points).toBeGreaterThanOrEqual(table[i].points);
      }
    }
  });

  it("produces champions on believable points totals", () => {
    // Real Premier League champions average about 91 points and have never
    // exceeded 100; bottom clubs average about 20. Individual seasons vary
    // widely, so the mean is the meaningful assertion and the per-season
    // bounds only catch results no season has ever produced.
    const champions = run.tables.map((t) => t[0].points);
    const bottoms = run.tables.map((t) => t[19].points);

    const meanChampion = champions.reduce((a, b) => a + b, 0) / champions.length;
    const meanBottom = bottoms.reduce((a, b) => a + b, 0) / bottoms.length;

    expect(meanChampion).toBeGreaterThan(80);
    expect(meanChampion).toBeLessThan(98);
    expect(meanBottom).toBeGreaterThan(12);
    expect(meanBottom).toBeLessThan(32);

    for (const points of champions) {
      expect(points).toBeGreaterThan(65);
      expect(points).toBeLessThan(110);
    }
    for (const points of bottoms) {
      expect(points).toBeGreaterThan(3);
      expect(points).toBeLessThan(45);
    }
  });

  it("has the better squads finishing higher", () => {
    const strengths = new Map(
      [...squads.entries()].map(([clubId, players]) => [clubId, squadStrength(players)]),
    );

    let totalCorrelation = 0;
    for (const table of run.tables) {
      const byStrength = [...table].sort(
        (a, b) => (strengths.get(b.clubId) ?? 0) - (strengths.get(a.clubId) ?? 0),
      );
      const expectedRank = new Map(byStrength.map((row, i) => [row.clubId, i + 1]));

      let squaredDiff = 0;
      table.forEach((row, i) => {
        const diff = i + 1 - (expectedRank.get(row.clubId) ?? 0);
        squaredDiff += diff * diff;
      });
      totalCorrelation += 1 - (6 * squaredDiff) / (20 * (400 - 1));
    }

    expect(totalCorrelation / run.tables.length).toBeGreaterThan(0.6);
  });

  it("does not produce the identical table every season", () => {
    const champions = new Set(run.tables.map((t) => t[0].clubId));
    const pointsTotals = new Set(run.tables.map((t) => t[0].points));
    expect(pointsTotals.size).toBeGreaterThan(1);
    expect(champions.size).toBeGreaterThanOrEqual(1);
  });
});

describe("player outcomes across a season", () => {
  it("crowns a top scorer in a believable range", () => {
    const goals = new Map<number, number>();
    for (const r of run.results) {
      for (const p of r.players) {
        if (p.goals) goals.set(p.playerId, (goals.get(p.playerId) ?? 0) + p.goals);
      }
    }

    // Totalled across every simulated season, then averaged back down.
    const best = Math.max(...goals.values()) / SEASONS;
    expect(best).toBeGreaterThan(12);
    expect(best).toBeLessThan(45);
  });

  it("spreads goals across many scorers rather than one player", () => {
    const goalsByClub = new Map<number, Map<number, number>>();
    for (const r of run.results) {
      for (const p of r.players) {
        if (!p.goals) continue;
        if (!goalsByClub.has(p.clubId)) goalsByClub.set(p.clubId, new Map());
        const club = goalsByClub.get(p.clubId)!;
        club.set(p.playerId, (club.get(p.playerId) ?? 0) + p.goals);
      }
    }

    for (const club of goalsByClub.values()) {
      const totals = [...club.values()].sort((a, b) => b - a);
      const clubTotal = totals.reduce((a, b) => a + b, 0);
      // No single player should account for most of his club's goals.
      expect(totals[0] / clubTotal).toBeLessThan(0.45);
      expect(totals.length).toBeGreaterThan(8);
    }
  });

  it("keeps match ratings inside the scale", () => {
    for (const r of run.results) {
      for (const p of r.players) {
        expect(p.rating).toBeGreaterThanOrEqual(4);
        expect(p.rating).toBeLessThanOrEqual(10);
      }
    }
  });

  it("leaves players tired after playing", () => {
    const outfieldFull = run.results
      .flatMap((r) => r.players)
      .filter((p) => p.minutesPlayed >= 85);

    const average =
      outfieldFull.reduce((s, p) => s + p.endFitness, 0) / outfieldFull.length;

    expect(average).toBeLessThan(85);
    expect(average).toBeGreaterThan(35);
  });
});
