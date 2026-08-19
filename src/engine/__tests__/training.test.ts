import { describe, it, expect } from "vitest";
import {
  FOCUS_ATTRIBUTES,
  TRAINING,
  accumulateDeltas,
  applyDeltas,
  isTrainingFocus,
  trainPlayer,
  trainSquad,
  type TrainableAttribute,
  type TrainingFocus,
  type TrainingIntensity,
} from "../training";
import { createRng } from "../rng";
import { makePlayer, resetPlayerIds } from "./factories";
import type { EnginePlayer, Position } from "../types";

const ALL_FOCUSES = Object.keys(FOCUS_ATTRIBUTES) as TrainingFocus[];

function player(
  overrides: { age?: number; overall?: number; positions?: Position[]; isGk?: boolean } = {},
) {
  resetPlayerIds();
  const isGk = overrides.isGk ?? false;
  return makePlayer({
    positions: isGk ? ["GK"] : ["ST"],
    ...overrides,
  });
}

/** Runs a whole season of training and reports the movement on one attribute. */
function season(
  p: EnginePlayer,
  potential: number,
  focus: TrainingFocus,
  intensity: TrainingIntensity = 3,
  weeks = 38,
): Partial<Record<TrainableAttribute, number>> {
  const rng = createRng(1);
  let deltas: Partial<Record<TrainableAttribute, number>> = {};
  for (let week = 0; week < weeks; week++) {
    const result = trainPlayer(rng, p, potential, focus, intensity);
    deltas = accumulateDeltas(deltas, result.deltas, p);
  }
  return deltas;
}

describe("trainPlayer", () => {
  it("improves the attributes the focus works on", () => {
    const p = player({ age: 20, overall: 70 });
    const deltas = season(p, 85, "finishing");
    expect(deltas.finishing!).toBeGreaterThan(0);
    expect(deltas.composure!).toBeGreaterThan(0);
  });

  it("moves a young player with room far more than an old one at his ceiling", () => {
    const young = season(player({ age: 19, overall: 65 }), 85, "finishing");
    const old = season(player({ age: 33, overall: 80 }), 80, "finishing");
    expect(young.finishing!).toBeGreaterThan(old.finishing! * 3);
  });

  it("keeps a season of work to a believable size", () => {
    // A season on one thing should be worth a few points, not twenty. If this
    // fails, squads will be unrecognisable by spring.
    const deltas = season(player({ age: 20, overall: 70 }), 88, "finishing");
    expect(deltas.finishing!).toBeGreaterThan(1);
    expect(deltas.finishing!).toBeLessThan(8);
  });

  it("gives a harder week more than a lighter one", () => {
    const p = player({ age: 22, overall: 72 });
    const light = season(p, 85, "defending", 1);
    const hard = season(p, 85, "defending", 5);
    expect(hard.marking!).toBeGreaterThan(light.marking!);
  });

  it("takes a player's legs once he is past thirty", () => {
    const deltas = season(player({ age: 34, overall: 78 }), 78, "finishing");
    expect(deltas.sprintSpeed!).toBeLessThan(0);
    expect(deltas.acceleration!).toBeLessThan(0);
  });

  it("trains aggression down rather than up on a discipline focus", () => {
    const deltas = season(player({ age: 24, overall: 74 }), 80, "discipline");
    expect(deltas.aggression!).toBeLessThan(0);
    expect(deltas.composure!).toBeGreaterThan(0);
  });

  it("does almost nothing for an outfielder put on goalkeeping work", () => {
    const outfield = season(player({ age: 20, overall: 70 }), 85, "goalkeeping");
    const keeper = season(player({ age: 20, overall: 70, isGk: true }), 85, "goalkeeping");
    expect(keeper.gkReflexes!).toBeGreaterThan(outfield.gkReflexes! * 5);
  });

  it("costs fitness in proportion to how hard the week was", () => {
    const p = player();
    const rng = createRng(2);
    const light = trainPlayer(rng, p, 80, "balanced", 1);
    const hard = trainPlayer(rng, p, 80, "balanced", 5);
    expect(light.fitnessCost).toBe(0);
    expect(hard.fitnessCost).toBeGreaterThan(light.fitnessCost);
  });

  it("breaks players down sometimes at high intensity and never at rest", () => {
    const p = player();
    let hardInjuries = 0;
    let lightInjuries = 0;

    for (let seed = 0; seed < 4000; seed++) {
      const rng = createRng(seed);
      if (trainPlayer(rng, p, 80, "fitness", 5).injury) hardInjuries++;
      const rng2 = createRng(seed);
      if (trainPlayer(rng2, p, 80, "fitness", 1).injury) lightInjuries++;
    }

    expect(hardInjuries).toBeGreaterThan(10);
    expect(lightInjuries).toBe(0);
  });

  it("is deterministic for a given seed", () => {
    const p = player();
    const a = trainPlayer(createRng(9), p, 85, "fitness", 4);
    const b = trainPlayer(createRng(9), p, 85, "fitness", 4);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("covers every focus without a gap in the table", () => {
    const p = player({ age: 20, overall: 68 });
    for (const focus of ALL_FOCUSES) {
      const result = trainPlayer(createRng(3), p, 85, focus, 3);
      expect(Object.keys(result.deltas).length).toBeGreaterThan(0);
      expect(isTrainingFocus(focus)).toBe(true);
    }
  });
});

describe("accumulateDeltas", () => {
  it("never pushes an attribute past the ceiling", () => {
    const p = player({ age: 18, overall: 70 });
    // Far more weeks than a career, to prove the clamp rather than the curve.
    const deltas = season(p, 99, "finishing", 5, 5000);
    const trained = applyDeltas(p, deltas);
    expect(trained.finishing).toBeLessThanOrEqual(TRAINING.attributeCeiling);
  });

  it("never pushes an attribute below the floor", () => {
    const p = player({ age: 38, overall: 60 });
    const deltas = season(p, 60, "balanced", 1, 5000);
    const trained = applyDeltas(p, deltas);
    expect(trained.sprintSpeed).toBeGreaterThanOrEqual(TRAINING.attributeFloor);
  });

  it("leaves untrained attributes exactly as they were", () => {
    const p = player({ age: 22, overall: 72 });
    const deltas = season(p, 85, "finishing");
    const trained = applyDeltas(p, deltas);
    expect(trained.gkDiving).toBe(p.gkDiving);
    expect(trained.name).toBe(p.name);
    expect(trained.id).toBe(p.id);
  });

  it("leaves a player untouched when there are no deltas", () => {
    const p = player();
    expect(applyDeltas(p, null)).toEqual(p);
    expect(applyDeltas(p, {})).toEqual(p);
  });
});

describe("trainSquad", () => {
  it("lets one player work on something different from the group", () => {
    resetPlayerIds();
    const a = makePlayer({ overall: 70, positions: ["ST"] });
    const b = makePlayer({ overall: 70, positions: ["ST"] });
    const squad = [
      { player: a, potential: 85 },
      { player: b, potential: 85 },
    ];

    const results = trainSquad(createRng(5), squad, {
      focus: "defending",
      intensity: 3,
      individual: { [b.id]: "finishing" },
    });

    expect(results).toHaveLength(2);
    expect(results[0].deltas.marking).toBeGreaterThan(0);
    expect(results[1].deltas.finishing).toBeGreaterThan(0);
    expect(results[1].deltas.marking ?? 0).toBe(0);
  });
});
