/**
 * Calibration harness.
 *
 * Simulates whole Premier League seasons from the committed player data and
 * reports the numbers that decide whether the engine feels like football:
 * goals per game, shots, cards, injuries, home advantage, and whether the
 * better squads actually finish higher.
 *
 *   npm run sim:season            one season, full table
 *   npm run sim:season -- 20      twenty seasons, aggregate report
 */

import { PL_CLUBS } from "../src/data/clubs";
import { loadPlayersByClub } from "../src/data/loadPlayers";
import { createRng } from "../src/engine/rng";
import { squadStrength } from "../src/engine/ratings";
import { createWorld, simulateSeason, type TableRow } from "../src/engine/season";
import type { MatchResult } from "../src/engine/types";

const seasons = Math.max(1, Number.parseInt(process.argv[2] ?? "1", 10) || 1);

const squads = loadPlayersByClub();
const clubNames = new Map(PL_CLUBS.map((c) => [c.id, c.name]));

type Aggregate = {
  matches: number;
  goals: number;
  homeGoals: number;
  awayGoals: number;
  homeWins: number;
  draws: number;
  awayWins: number;
  shots: number;
  shotsOnTarget: number;
  yellows: number;
  reds: number;
  injuries: number;
  topScorer: { name: string; goals: number };
  /** Leading scorer in each individual season, for a mean and a maximum. */
  seasonTopScorers: number[];
};

const agg: Aggregate = {
  matches: 0,
  goals: 0,
  homeGoals: 0,
  awayGoals: 0,
  homeWins: 0,
  draws: 0,
  awayWins: 0,
  shots: 0,
  shotsOnTarget: 0,
  yellows: 0,
  reds: 0,
  injuries: 0,
  topScorer: { name: "", goals: 0 },
  seasonTopScorers: [],
};

/** Rank correlation between squad strength and final league position. */
function rankCorrelation(table: TableRow[]): number {
  const strengths = new Map(
    [...squads.entries()].map(([clubId, players]) => [clubId, squadStrength(players)]),
  );

  const byStrength = [...table].sort(
    (a, b) => (strengths.get(b.clubId) ?? 0) - (strengths.get(a.clubId) ?? 0),
  );
  const expectedRank = new Map(byStrength.map((row, i) => [row.clubId, i + 1]));

  const n = table.length;
  let sumSquaredDiff = 0;
  table.forEach((row, i) => {
    const diff = i + 1 - (expectedRank.get(row.clubId) ?? 0);
    sumSquaredDiff += diff * diff;
  });

  return 1 - (6 * sumSquaredDiff) / (n * (n * n - 1));
}

function accumulate(results: MatchResult[]): void {
  for (const r of results) {
    agg.matches++;
    agg.goals += r.homeGoals + r.awayGoals;
    agg.homeGoals += r.homeGoals;
    agg.awayGoals += r.awayGoals;

    if (r.homeGoals > r.awayGoals) agg.homeWins++;
    else if (r.homeGoals < r.awayGoals) agg.awayWins++;
    else agg.draws++;

    agg.shots += r.homeStats.shots + r.awayStats.shots;
    agg.shotsOnTarget += r.homeStats.shotsOnTarget + r.awayStats.shotsOnTarget;
    agg.yellows += r.homeStats.yellowCards + r.awayStats.yellowCards;
    agg.reds += r.homeStats.redCards + r.awayStats.redCards;
    agg.injuries += r.events.filter((e) => e.type === "injury").length;
  }
}

function printTable(table: TableRow[]): void {
  console.log("\nPos  Club                         P   W   D   L   GF   GA   GD  Pts");
  console.log("".padEnd(72, "-"));
  table.forEach((row, i) => {
    const gd = row.goalsFor - row.goalsAgainst;
    console.log(
      `${String(i + 1).padStart(3)}  ${row.clubName.padEnd(26)} ${String(row.played).padStart(2)}  ${String(row.won).padStart(2)}  ${String(row.drawn).padStart(2)}  ${String(row.lost).padStart(2)}  ${String(row.goalsFor).padStart(3)}  ${String(row.goalsAgainst).padStart(3)}  ${String(gd).padStart(3)}  ${String(row.points).padStart(3)}`,
    );
  });
}

const correlations: number[] = [];
const start = Date.now();

for (let season = 0; season < seasons; season++) {
  const world = createWorld(new Map(squads), clubNames);
  const rng = createRng(1000 + season);
  const { table, results } = simulateSeason(world, rng, season);

  accumulate(results);
  correlations.push(rankCorrelation(table));

  // Track the leading scorer across all simulated seasons.
  const goalsByPlayer = new Map<number, { name: string; goals: number }>();
  for (const r of results) {
    for (const p of r.players) {
      if (p.goals === 0) continue;
      const squad = [...squads.values()].flat();
      const player = squad.find((x) => x.id === p.playerId);
      if (!player) continue;
      const entry = goalsByPlayer.get(p.playerId) ?? { name: player.name, goals: 0 };
      entry.goals += p.goals;
      goalsByPlayer.set(p.playerId, entry);
    }
  }
  let seasonBest = 0;
  for (const entry of goalsByPlayer.values()) {
    if (entry.goals > agg.topScorer.goals) agg.topScorer = entry;
    if (entry.goals > seasonBest) seasonBest = entry.goals;
  }
  agg.seasonTopScorers.push(seasonBest);

  if (seasons === 1) {
    printTable(table);

    const scorers = [...goalsByPlayer.values()].sort((a, b) => b.goals - a.goals).slice(0, 10);
    console.log("\nLeading scorers");
    for (const s of scorers) console.log(`  ${s.goals.toString().padStart(2)}  ${s.name}`);
  }
}

const elapsed = ((Date.now() - start) / 1000).toFixed(1);
const perMatch = (value: number) => (value / agg.matches).toFixed(2);
const pct = (value: number) => ((value / agg.matches) * 100).toFixed(1);
const avgCorrelation = correlations.reduce((a, b) => a + b, 0) / correlations.length;

console.log(`\nSimulated ${seasons} season(s), ${agg.matches} matches in ${elapsed}s`);
console.log("".padEnd(52, "-"));
console.log(`  goals per match        ${perMatch(agg.goals).padStart(6)}   target ~2.80`);
console.log(`  home goals per match   ${perMatch(agg.homeGoals).padStart(6)}`);
console.log(`  away goals per match   ${perMatch(agg.awayGoals).padStart(6)}`);
console.log(`  shots per team         ${(agg.shots / agg.matches / 2).toFixed(2).padStart(6)}   target ~12.5`);
console.log(`  on target per team     ${(agg.shotsOnTarget / agg.matches / 2).toFixed(2).padStart(6)}   target ~4.3`);
console.log(`  home wins              ${pct(agg.homeWins).padStart(6)}%  target ~44%`);
console.log(`  draws                  ${pct(agg.draws).padStart(6)}%  target ~23%`);
console.log(`  away wins              ${pct(agg.awayWins).padStart(6)}%  target ~33%`);
console.log(`  yellows per match      ${perMatch(agg.yellows).padStart(6)}   target ~4.0`);
console.log(`  reds per match         ${perMatch(agg.reds).padStart(6)}   target ~0.15`);
console.log(`  injuries per match     ${perMatch(agg.injuries).padStart(6)}   target ~0.35`);
console.log(`  strength correlation   ${avgCorrelation.toFixed(3).padStart(6)}   target >0.60`);
const meanTopScorer =
  agg.seasonTopScorers.reduce((a, b) => a + b, 0) / agg.seasonTopScorers.length;
console.log(`  top scorer per season  ${meanTopScorer.toFixed(1).padStart(6)}   target ~25`);
console.log(`  highest ever recorded  ${String(agg.topScorer.goals).padStart(6)}   ${agg.topScorer.name}`);
