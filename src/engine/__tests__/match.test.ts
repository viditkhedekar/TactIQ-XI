import { describe, it, expect } from "vitest";
import {
  createMatchState,
  simulateSegment,
  simulateToEnd,
  applyIntervention,
  applySubstitution,
  buildMatchResult,
} from "../match";
import { aiMinuteHook } from "../aiManager";
import { makeSide, resetPlayerIds } from "./factories";
import type { MatchEvent, MatchState, TeamTactics } from "../types";

function newMatch(seed: number, homeLevel = 75, awayLevel = 75, tactics?: Partial<TeamTactics>) {
  // Same ids every time, so two runs of the same seed are comparable.
  resetPlayerIds();
  const home = makeSide({ clubId: 1, clubName: "Home FC", level: homeLevel, isHome: true, tactics });
  const away = makeSide({ clubId: 2, clubName: "Away FC", level: awayLevel, isHome: false });
  return createMatchState("fixture-1", seed, home, away);
}

function playFull(seed: number, homeLevel = 75, awayLevel = 75): {
  state: MatchState;
  events: MatchEvent[];
} {
  const state = newMatch(seed, homeLevel, awayLevel);
  const events = simulateToEnd(state, aiMinuteHook);
  return { state, events };
}

describe("simulateToEnd", () => {
  it("plays a complete match", () => {
    const { state, events } = playFull(1);
    expect(state.finished).toBe(true);
    expect(state.minute).toBeGreaterThanOrEqual(90);
    expect(events[0].type).toBe("kickoff");
    expect(events[events.length - 1].type).toBe("fulltime");
    expect(events.some((e) => e.type === "halftime")).toBe(true);
  });

  it("gives every event a unique increasing sequence number", () => {
    const { events } = playFull(2);
    const seqs = events.map((e) => e.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
  });

  it("keeps minutes within the match and never goes backwards", () => {
    const { events } = playFull(3);
    for (let i = 1; i < events.length; i++) {
      expect(events[i].minute).toBeGreaterThanOrEqual(events[i - 1].minute);
    }
    expect(events[events.length - 1].minute).toBeLessThanOrEqual(100);
  });

  it("keeps the score consistent with the goal events", () => {
    for (const seed of [10, 11, 12, 13, 14]) {
      const { state, events } = playFull(seed);
      const homeGoals = events.filter((e) => e.type === "goal" && e.clubId === 1).length;
      const awayGoals = events.filter((e) => e.type === "goal" && e.clubId === 2).length;
      expect(state.homeGoals).toBe(homeGoals);
      expect(state.awayGoals).toBe(awayGoals);
    }
  });

  it("produces commentary for every event", () => {
    const { events } = playFull(4);
    for (const event of events) {
      expect(event.commentary.length).toBeGreaterThan(0);
      expect(event.commentary).not.toMatch(/\{|\}|undefined/);
    }
  });

  it("never lets a side make more than five substitutions", () => {
    for (const seed of [20, 21, 22]) {
      const { state } = playFull(seed);
      expect(state.home.subsUsed).toBeLessThanOrEqual(5);
      expect(state.away.subsUsed).toBeLessThanOrEqual(5);
    }
  });

  it("never puts more than eleven players on the pitch", () => {
    for (const seed of [30, 31, 32]) {
      const { state } = playFull(seed);
      expect(state.home.onPitch).toHaveLength(11);
      expect(state.away.onPitch).toHaveLength(11);
      expect(state.home.onPitch.filter((lp) => lp.player.isGk)).toHaveLength(1);
    }
  });

  it("tires players out over ninety minutes", () => {
    const { state } = playFull(5);
    const outfield = state.home.onPitch.filter((lp) => !lp.player.isGk);
    for (const lp of outfield) {
      if (lp.onAtMinute === 0) expect(lp.fitness).toBeLessThan(100);
    }
  });

  it("records shots that are at least as many as the goals", () => {
    const { state } = playFull(6);
    expect(state.homeStats.shots).toBeGreaterThanOrEqual(state.homeStats.shotsOnTarget);
    expect(state.homeStats.shotsOnTarget).toBeGreaterThanOrEqual(state.homeGoals);
  });

  it("splits possession between the two sides", () => {
    const { state } = playFull(7);
    expect(state.homeStats.possession + state.awayStats.possession).toBe(100);
  });
});

describe("determinism", () => {
  it("produces an identical event log for the same seed", () => {
    const a = playFull(12345);
    const b = playFull(12345);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(a.state.homeGoals).toBe(b.state.homeGoals);
    expect(a.state.awayGoals).toBe(b.state.awayGoals);
  });

  it("produces different matches for different seeds", () => {
    const results = [1, 2, 3, 4, 5, 6].map((s) => {
      const { state } = playFull(s);
      return `${state.homeGoals}-${state.awayGoals}`;
    });
    expect(new Set(results).size).toBeGreaterThan(1);
  });

  it("resumes identically from a serialized state", () => {
    // This is the guarantee the whole pause-and-resume design rests on: a
    // match state that has been through JSON must continue the same way.
    const original = newMatch(999);
    const first = simulateSegment(original, { onMinute: aiMinuteHook });

    const revived: MatchState = JSON.parse(JSON.stringify(original));
    const continuedOriginal = simulateToEnd(original, aiMinuteHook);
    const continuedRevived = simulateToEnd(revived, aiMinuteHook);

    expect(JSON.stringify(continuedRevived)).toBe(JSON.stringify(continuedOriginal));
    expect(revived.homeGoals).toBe(original.homeGoals);
    expect(first.events.length).toBeGreaterThan(0);
  });

  it("reproduces the same prefix when a segment is replayed from its start", () => {
    // Rewinding to apply a substitution re-simulates from the segment start.
    // Without this property the manager would see history rewritten.
    const state = newMatch(4242);
    simulateSegment(state, { onMinute: aiMinuteHook });

    const checkpoint: MatchState = JSON.parse(JSON.stringify(state));
    const runA = simulateSegment(state, { onMinute: aiMinuteHook });
    const runB = simulateSegment(JSON.parse(JSON.stringify(checkpoint)), {
      onMinute: aiMinuteHook,
    });

    expect(JSON.stringify(runB.events)).toBe(JSON.stringify(runA.events));
    expect(runB.boundary).toBe(runA.boundary);
  });
});

describe("simulateSegment", () => {
  it("stops at a boundary and reports why", () => {
    const state = newMatch(77);
    const { boundary, events } = simulateSegment(state, { onMinute: aiMinuteHook });
    expect(["goal", "red_card", "injury", "halftime", "fulltime", "interval"]).toContain(boundary);
    expect(events.length).toBeGreaterThan(0);
  });

  it("advances the match a segment at a time until it finishes", () => {
    const state = newMatch(88);
    let guard = 0;
    let total = 0;

    while (!state.finished && guard++ < 200) {
      const { events } = simulateSegment(state, { onMinute: aiMinuteHook });
      total += events.length;
    }

    expect(state.finished).toBe(true);
    expect(total).toBeGreaterThan(5);
    expect(guard).toBeLessThan(200);
  });

  it("stops at half time", () => {
    const state = newMatch(55);
    let guard = 0;
    let sawHalfTime = false;

    while (!state.finished && guard++ < 200) {
      const { boundary } = simulateSegment(state, { onMinute: aiMinuteHook });
      if (boundary === "halftime") sawHalfTime = true;
    }

    expect(sawHalfTime).toBe(true);
  });

  it("does nothing once the match is over", () => {
    const state = newMatch(66);
    simulateToEnd(state, aiMinuteHook);
    const { events, boundary } = simulateSegment(state);
    expect(events).toHaveLength(0);
    expect(boundary).toBe("fulltime");
  });
});

describe("substitutions", () => {
  it("swaps a player on and off, and records it", () => {
    const state = newMatch(101);
    simulateSegment(state, { onMinute: aiMinuteHook });

    const off = state.home.onPitch.find((lp) => lp.slot === "ST")!;
    const on = state.home.bench.find((lp) => !lp.player.isGk)!;
    const events: MatchEvent[] = [];

    const applied = applyIntervention(state, true, {
      subs: [{ off: off.player.id, on: on.player.id }],
    }, events);

    expect(applied.subsApplied).toBe(1);
    expect(state.home.onPitch.some((lp) => lp.player.id === on.player.id)).toBe(true);
    expect(state.home.onPitch.some((lp) => lp.player.id === off.player.id)).toBe(false);
    expect(on.slot).toBe("ST");
    expect(events.some((e) => e.type === "sub")).toBe(true);
  });

  it("refuses a player who is not on the bench", () => {
    const state = newMatch(102);
    const off = state.home.onPitch[5];
    const applied = applyIntervention(state, true, {
      subs: [{ off: off.player.id, on: 999_999 }],
    }, []);
    expect(applied.subsApplied).toBe(0);
    expect(state.home.subsUsed).toBe(0);
  });

  it("refuses to take off a player who is not on the pitch", () => {
    const state = newMatch(103);
    const on = state.home.bench[1];
    const applied = applyIntervention(state, true, {
      subs: [{ off: 999_999, on: on.player.id }],
    }, []);
    expect(applied.subsApplied).toBe(0);
  });

  it("refuses to replace an outfielder with a goalkeeper", () => {
    const state = newMatch(104);
    const off = state.home.onPitch.find((lp) => lp.slot === "ST")!;
    const keeper = state.home.bench.find((lp) => lp.player.isGk)!;
    const applied = applyIntervention(state, true, {
      subs: [{ off: off.player.id, on: keeper.player.id }],
    }, []);
    expect(applied.subsApplied).toBe(0);
  });

  it("refuses a sixth substitution", () => {
    const state = newMatch(105);
    let made = 0;

    for (let i = 0; i < 7; i++) {
      const off = state.home.onPitch.find((lp) => !lp.player.isGk && lp.onAtMinute === 0);
      const on = state.home.bench.find(
        (lp) => !lp.player.isGk && lp.offAtMinute === null && lp.minutesPlayed === 0,
      );
      if (!off || !on) break;
      if (applySubstitution(state, state.home, { off: off.player.id, on: on.player.id }, null)) {
        made++;
      }
    }

    expect(made).toBe(5);
    expect(state.home.subsUsed).toBe(5);
  });

  it("will not bring a substituted player back on", () => {
    const state = newMatch(106);
    const off = state.home.onPitch.find((lp) => lp.slot === "ST")!;
    const on = state.home.bench.find((lp) => !lp.player.isGk)!;

    applySubstitution(state, state.home, { off: off.player.id, on: on.player.id }, null);
    const second = applySubstitution(
      state,
      state.home,
      { off: on.player.id, on: off.player.id },
      null,
    );

    expect(second).toBe(false);
  });
});

describe("mid-match tactic changes", () => {
  it("applies a change and records it", () => {
    const state = newMatch(201);
    const events: MatchEvent[] = [];
    const result = applyIntervention(state, true, { tactics: { mentality: 5 } }, events);

    expect(result.tacticsChanged).toBe(true);
    expect(state.home.tactics.mentality).toBe(5);
    expect(events.some((e) => e.type === "tactic_change")).toBe(true);
  });

  it("reports no change when the instructions are identical", () => {
    const state = newMatch(202);
    const result = applyIntervention(
      state,
      true,
      { tactics: { mentality: state.home.tactics.mentality } },
      [],
    );
    expect(result.tacticsChanged).toBe(false);
  });

  it("clamps a tampered payload rather than accepting it", () => {
    const state = newMatch(203);
    applyIntervention(state, true, {
      tactics: { mentality: 99, pressing: -5 } as never,
    }, []);
    expect(state.home.tactics.mentality).toBe(5);
    expect(state.home.tactics.pressing).toBe(1);
  });

  it("changes the course of the match", () => {
    // Same seed, but one run switches to all-out attack at the first pause.
    const control = newMatch(3001);
    simulateSegment(control, { onMinute: aiMinuteHook });
    simulateToEnd(control, aiMinuteHook);

    const changed = newMatch(3001);
    simulateSegment(changed, { onMinute: aiMinuteHook });
    applyIntervention(changed, true, { tactics: { mentality: 5, tempo: 5, pressing: 5 } }, []);
    simulateToEnd(changed, aiMinuteHook);

    const controlScore = `${control.homeGoals}-${control.awayGoals}`;
    const changedScore = `${changed.homeGoals}-${changed.awayGoals}`;
    expect(controlScore !== changedScore || control.homeStats.shots !== changed.homeStats.shots)
      .toBe(true);
  });
});

describe("tactics affect outcomes over many matches", () => {
  function averageGoals(tactics: Partial<TeamTactics>, matches = 120) {
    let scored = 0;
    let conceded = 0;

    for (let seed = 0; seed < matches; seed++) {
      resetPlayerIds();
      const home = makeSide({ clubId: 1, clubName: "A", level: 75, isHome: true, tactics });
      const away = makeSide({ clubId: 2, clubName: "B", level: 75, isHome: false });
      const state = createMatchState("f", seed * 7919 + 13, home, away);
      simulateToEnd(state, aiMinuteHook);
      scored += state.homeGoals;
      conceded += state.awayGoals;
    }

    return { scored: scored / matches, conceded: conceded / matches };
  }

  it("makes attacking sides score and concede more than defensive ones", () => {
    const attacking = averageGoals({ mentality: 5 });
    const defensive = averageGoals({ mentality: 1 });

    expect(attacking.scored).toBeGreaterThan(defensive.scored);
    expect(attacking.conceded).toBeGreaterThan(defensive.conceded);
  });

  it("makes a stronger squad win more often", () => {
    let strongWins = 0;
    let weakWins = 0;

    for (let seed = 0; seed < 150; seed++) {
      const { state } = playFull(seed * 31 + 5, 84, 66);
      if (state.homeGoals > state.awayGoals) strongWins++;
      else if (state.homeGoals < state.awayGoals) weakWins++;
    }

    expect(strongWins).toBeGreaterThan(weakWins * 2);
  });
});

describe("buildMatchResult", () => {
  it("summarises the match for career state", () => {
    const { state, events } = playFull(500);
    const result = buildMatchResult(state, events);

    expect(result.homeGoals).toBe(state.homeGoals);
    expect(result.players.length).toBeGreaterThan(20);

    for (const p of result.players) {
      expect(p.minutesPlayed).toBeGreaterThan(0);
      expect(p.rating).toBeGreaterThanOrEqual(4);
      expect(p.rating).toBeLessThanOrEqual(10);
      expect(p.endFitness).toBeGreaterThanOrEqual(0);
      expect([1, 2]).toContain(p.clubId);
    }
  });

  it("has player goals adding up to the team score", () => {
    for (const seed of [601, 602, 603]) {
      const { state, events } = playFull(seed);
      const result = buildMatchResult(state, events);
      const home = result.players
        .filter((p) => p.clubId === 1)
        .reduce((sum, p) => sum + p.goals, 0);
      expect(home).toBe(result.homeGoals);
    }
  });

  it("only carries injuries that actually cost rounds", () => {
    const { state, events } = playFull(700);
    const result = buildMatchResult(state, events);
    for (const p of result.players) {
      if (p.injury) expect(p.injury.outRounds).toBeGreaterThan(0);
    }
  });
});
