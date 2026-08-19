import { describe, it, expect } from "vitest";
import {
  createRng,
  next,
  chance,
  randInt,
  pick,
  weightedIndex,
  shuffle,
  randNormal,
  hash32,
} from "../rng";

describe("rng", () => {
  it("produces the same stream for the same seed", () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const seqA = Array.from({ length: 50 }, () => next(a));
    const seqB = Array.from({ length: 50 }, () => next(b));
    expect(seqA).toEqual(seqB);
  });

  it("produces different streams for different seeds", () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(next(a)).not.toEqual(next(b));
  });

  it("resumes identically from a captured state", () => {
    const rng = createRng(777);
    for (let i = 0; i < 20; i++) next(rng);

    const snapshot = { ...rng };
    const original = Array.from({ length: 30 }, () => next(rng));
    const resumed = Array.from({ length: 30 }, () => next(snapshot));

    expect(resumed).toEqual(original);
  });

  it("stays within [0, 1)", () => {
    const rng = createRng(42);
    for (let i = 0; i < 10_000; i++) {
      const v = next(rng);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("is roughly uniform across ten buckets", () => {
    const rng = createRng(9);
    const buckets = new Array(10).fill(0);
    const n = 100_000;
    for (let i = 0; i < n; i++) buckets[Math.floor(next(rng) * 10)]++;
    for (const count of buckets) {
      expect(count).toBeGreaterThan(n / 10 - n / 100);
      expect(count).toBeLessThan(n / 10 + n / 100);
    }
  });

  it("honours chance() edge probabilities without consuming determinism guarantees", () => {
    const rng = createRng(3);
    expect(chance(rng, 0)).toBe(false);
    expect(chance(rng, -1)).toBe(false);
    expect(chance(rng, 1)).toBe(true);
    expect(chance(rng, 5)).toBe(true);
  });

  it("approximates the requested probability", () => {
    const rng = createRng(555);
    let hits = 0;
    const n = 50_000;
    for (let i = 0; i < n; i++) if (chance(rng, 0.3)) hits++;
    expect(hits / n).toBeGreaterThan(0.29);
    expect(hits / n).toBeLessThan(0.31);
  });

  it("keeps randInt inside the inclusive range and hits both ends", () => {
    const rng = createRng(11);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const v = randInt(rng, 3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      seen.add(v);
    }
    expect(seen).toEqual(new Set([3, 4, 5, 6, 7]));
    expect(randInt(rng, 5, 5)).toBe(5);
  });

  it("throws when picking from an empty list", () => {
    const rng = createRng(1);
    expect(() => pick(rng, [])).toThrow();
  });

  it("weights selection proportionally", () => {
    const rng = createRng(202);
    const counts = [0, 0, 0];
    const n = 60_000;
    for (let i = 0; i < n; i++) counts[weightedIndex(rng, [1, 3, 0])]++;

    expect(counts[2]).toBe(0);
    expect(counts[0] / n).toBeGreaterThan(0.23);
    expect(counts[0] / n).toBeLessThan(0.27);
    expect(counts[1] / n).toBeGreaterThan(0.73);
    expect(counts[1] / n).toBeLessThan(0.77);
  });

  it("returns a valid index when all weights are zero", () => {
    const rng = createRng(4);
    expect(weightedIndex(rng, [0, 0, 0])).toBe(2);
  });

  it("shuffles without losing or duplicating elements", () => {
    const rng = createRng(88);
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = shuffle(rng, input);
    expect(out.slice().sort((a, b) => a - b)).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("centres randNormal on the requested mean", () => {
    const rng = createRng(31);
    let sum = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) sum += randNormal(rng, 70, 10);
    expect(sum / n).toBeGreaterThan(69);
    expect(sum / n).toBeLessThan(71);
  });

  it("hashes strings stably and distinguishes different inputs", () => {
    expect(hash32("arsenal-liverpool")).toBe(hash32("arsenal-liverpool"));
    expect(hash32("a")).not.toBe(hash32("b"));
    expect(hash32("x")).toBeGreaterThanOrEqual(0);
  });
});
