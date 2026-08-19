/**
 * Deterministic RNG for the match engine.
 *
 * The whole simulation must be reproducible from a seed: replaying a match
 * from a saved state has to regenerate the exact events the player already
 * watched, otherwise mid-match tactic changes would rewrite history. That
 * rules out Math.random and requires a generator whose entire state is one
 * serializable number.
 *
 * mulberry32: 32-bit state, good distribution, fast.
 */

export type RngState = { s: number };

export function createRng(seed: number): RngState {
  return { s: seed >>> 0 };
}

/** Uniform float in [0, 1). Advances the state. */
export function next(rng: RngState): number {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** True with probability p (clamped to [0, 1]). */
export function chance(rng: RngState, p: number): boolean {
  if (p <= 0) return false;
  if (p >= 1) return true;
  return next(rng) < p;
}

/** Integer in [min, max] inclusive. */
export function randInt(rng: RngState, min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(next(rng) * (max - min + 1));
}

/** Float in [min, max). */
export function randRange(rng: RngState, min: number, max: number): number {
  return min + next(rng) * (max - min);
}

/** Uniformly picks one element. Throws on an empty list rather than returning undefined. */
export function pick<T>(rng: RngState, items: readonly T[]): T {
  if (items.length === 0) throw new Error("pick() called with an empty list");
  return items[Math.floor(next(rng) * items.length)];
}

/**
 * Picks an index from a list of non-negative weights, proportionally.
 * Falls back to the last index if every weight is zero.
 */
export function weightedIndex(rng: RngState, weights: readonly number[]): number {
  let total = 0;
  for (const w of weights) total += w > 0 ? w : 0;
  if (total <= 0) return weights.length - 1;

  let roll = next(rng) * total;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i] > 0 ? weights[i] : 0;
    roll -= w;
    if (roll < 0) return i;
  }
  return weights.length - 1;
}

/** Weighted pick over parallel arrays of items and weights. */
export function weightedPick<T>(rng: RngState, items: readonly T[], weights: readonly number[]): T {
  return items[weightedIndex(rng, weights)];
}

/** Fisher-Yates, returning a new array. */
export function shuffle<T>(rng: RngState, items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next(rng) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Approximately normal via the mean of 3 uniforms (Bates distribution),
 * scaled to the requested mean and standard deviation. Bounded, unlike a
 * true gaussian, which keeps simulated values from producing absurd outliers.
 */
export function randNormal(rng: RngState, mean: number, sd: number): number {
  const u = (next(rng) + next(rng) + next(rng)) / 3;
  return mean + (u - 0.5) * 3.464 * sd;
}

/**
 * Stable 32-bit hash of a string. Used to derive per-fixture seeds from ids
 * so that a given match always replays identically.
 */
export function hash32(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
