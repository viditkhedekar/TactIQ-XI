/**
 * Ticker colour must be free.
 *
 * The engine's numbers were tuned empirically against real Premier League rates
 * over several passes, and that tuning is only valid while the sequence of
 * draws from the match RNG stays fixed. Commentary is the easiest place to
 * break that by accident: one extra `pick` inside a line function shifts every
 * roll after it, and the unit tests all still pass while a season quietly stops
 * looking like a season.
 *
 * These tests pin the property down. The golden figures below were taken from
 * the engine as it stood before colour was added. If a change to commentary
 * moves them, that change is touching the simulation and needs the season
 * harness run against it, not just a green suite.
 */

import { describe, it, expect } from "vitest";
import { createMatchState, simulateToEnd } from "../match";
import { aiMinuteHook } from "../aiManager";
import { makeSide, resetPlayerIds } from "./factories";
import { COLOUR_EVENT_TYPES, isColourEvent, isShotEvent } from "../types";
import type { MatchEvent } from "../types";

/** seed, home goals, away goals, home shots, away shots, total yellows. */
const GOLDEN: [number, number, number, number, number, number][] = [
  [1, 3, 1, 20, 6, 4],
  [2, 6, 3, 17, 11, 5],
  [3, 2, 2, 23, 8, 3],
  [42, 1, 1, 19, 11, 2],
  [999, 2, 0, 16, 9, 3],
  [12345, 1, 1, 15, 6, 3],
];

function play(seed: number) {
  resetPlayerIds();
  const home = makeSide({ clubId: 1, clubName: "Home FC", level: 78, isHome: true });
  const away = makeSide({ clubId: 2, clubName: "Away FC", level: 72, isHome: false });
  const state = createMatchState("fixture-1", seed, home, away);
  const events = simulateToEnd(state, aiMinuteHook);
  return { state, events };
}

describe("colour does not touch the simulation", () => {
  it("reproduces the outcomes the engine produced before colour existed", () => {
    for (const [seed, homeGoals, awayGoals, homeShots, awayShots, yellows] of GOLDEN) {
      const { state } = play(seed);
      expect({
        seed,
        homeGoals: state.homeGoals,
        awayGoals: state.awayGoals,
        homeShots: state.homeStats.shots,
        awayShots: state.awayStats.shots,
        yellows: state.homeStats.yellowCards + state.awayStats.yellowCards,
      }).toEqual({ seed, homeGoals, awayGoals, homeShots, awayShots, yellows });
    }
  });

  it("counts no colour event towards the statistics", () => {
    const { state, events } = play(7);
    const colour = events.filter((e) => isColourEvent(e.type));

    // A woodwork or a goal-line clearance is a relabelled miss, so it is
    // already in the shot tally and must be counted exactly once.
    const realShots = events.filter((e) => isShotEvent(e.type));

    expect(colour.length).toBeGreaterThan(0);
    expect(realShots.length).toBe(state.homeStats.shots + state.awayStats.shots);
    for (const event of colour) expect(event.data?.colour ?? false).toBe(true);
    for (const event of realShots) expect(isColourEvent(event.type)).toBe(false);
  });
});

describe("colour reads properly", () => {
  it("produces a good deal more to read than the incidents alone", () => {
    const { events } = play(21);
    const colour = events.filter((e) => isColourEvent(e.type));
    // A quiet match used to run to roughly forty lines. Colour should be
    // carrying a substantial share of the ticker, not sprinkling it.
    expect(colour.length).toBeGreaterThan(25);
  });

  it("leaves no placeholder or undefined in any line", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { events } = play(seed);
      for (const event of events) {
        expect(event.commentary).not.toMatch(/\{|\}|undefined/);
        expect(event.commentary.length).toBeGreaterThan(5);
      }
    }
  });

  it("stays quiet for a moment after a goal", () => {
    const { events } = play(2);
    const goals = events.filter((e) => e.type === "goal");
    expect(goals.length).toBeGreaterThan(0);

    for (const goal of goals) {
      // A goal is allowed its own VAR check in the same minute; anything else
      // decorative should hold off while the goal is being described.
      const chatter = events.filter(
        (e: MatchEvent) =>
          e.seq > goal.seq &&
          e.minute === goal.minute &&
          isColourEvent(e.type) &&
          e.type !== "var_check" &&
          e.type !== "corner",
      );
      expect(chatter).toHaveLength(0);
    }
  });

  it("is deterministic, so a rewind reproduces the same lines", () => {
    const a = play(3030);
    const b = play(3030);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });

  it("uses every colour type it advertises across a run of matches", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) {
      for (const event of play(seed).events) {
        if (isColourEvent(event.type)) seen.add(event.type);
      }
    }
    for (const type of COLOUR_EVENT_TYPES) expect(seen).toContain(type);
  });
});
