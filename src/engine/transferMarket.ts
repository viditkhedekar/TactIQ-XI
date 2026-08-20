/**
 * Valuing players, and deciding whether a bid is good enough.
 *
 * The market is a negotiation rather than a shop. A club has an asking price
 * that is not its player's market value: it is the value plus however much it
 * would hurt to lose him, which is why prising a first-choice striker away
 * costs far more than his listed worth and why a reserve can be had for less.
 * The same idea runs through wages, where a player's demand depends on who is
 * asking as much as on what he currently earns.
 *
 * Everything here is pure. It takes plain numbers and a seeded RNG, returns a
 * verdict, and knows nothing about the database, the career, or whose turn it
 * is. That keeps the awkward judgement calls unit-testable and lets the AI
 * clubs and the manager go through exactly the same code.
 */

import { randRange, type RngState } from "./rng";
import type { EnginePlayer, Position } from "./types";

export const TRANSFER = {
  /**
   * The two windows, as inclusive round ranges.
   *
   * Each is several rounds wide because a deal is not instant: a bid gets a
   * response the following round, and a haggle costs another. A one-round
   * window would mean every offer expired before anyone could answer it.
   */
  summerWindow: [1, 4] as const,
  januaryWindow: [20, 23] as const,
  /** Rounds between an offer being made and the selling club responding. */
  responseDelay: 1,

  /** Squad size limits, enforced on both sides of a deal. */
  minSquadSize: 18,
  maxSquadSize: 32,

  /** Nobody sells at the listed price. */
  basePremium: 1.18,
  /** A club's best player costs this much more than his market value. */
  keyPlayerPremium: 0.45,
  /** A player nobody picks can be had for less. */
  fringeDiscount: 0.22,
  /** Form swings the asking price by up to this share either way. */
  formSwing: 0.14,
  /** Under-23s with room to grow carry a premium on top. */
  potentialPremium: 0.4,
  /** Random haggling noise, so the same player is not always the same price. */
  priceNoise: 0.07,

  /** A bid at least this share of the asking price gets a counter, not a no. */
  counterThreshold: 0.82,
  /** A counter splits the difference, leaning this far towards the seller. */
  counterLean: 0.6,

  /** Wage demand as a multiple of current wage, before anything else. */
  baseWageDemand: 1.15,
  /** Joining a clearly weaker side costs this much more in wages. */
  stepDownWagePenalty: 0.5,
  /** Joining a clearly stronger side is worth taking less for. */
  stepUpWageDiscount: 0.15,
  /** Squad strength difference that counts as a full step up or down. */
  stepRatingSpan: 8,

  /** A player will not drop further than this many rating points, at any wage. */
  maxStepDown: 14,

  /** Bids the AI will consider making per window, per club. */
  aiBidsPerWindow: 3,
  /** How far above its own asking price an AI club will go for a target. */
  aiMaxOverpay: 0.25,
};

/* ------------------------------------------------------------------ valuing */

/** Broad position groups, which is the level squad depth is judged at. */
export type PositionGroup = "GK" | "DEF" | "MID" | "ATT";

const POSITION_GROUP: Record<Position, PositionGroup> = {
  GK: "GK",
  CB: "DEF",
  LB: "DEF",
  RB: "DEF",
  LWB: "DEF",
  RWB: "DEF",
  CDM: "MID",
  CM: "MID",
  CAM: "MID",
  LM: "MID",
  RM: "MID",
  LW: "ATT",
  RW: "ATT",
  CF: "ATT",
  ST: "ATT",
};

export function groupOf(player: EnginePlayer): PositionGroup {
  return POSITION_GROUP[player.positions[0]] ?? "MID";
}

/** How many of each group a squad wants before it starts feeling thin. */
const TARGET_DEPTH: Record<PositionGroup, number> = {
  GK: 3,
  DEF: 8,
  MID: 8,
  ATT: 6,
};

/**
 * A player's market value.
 *
 * The source data carries a value in euros, which is the right starting point
 * because it already encodes reputation and contract length in a way the
 * attributes do not. It is adjusted here only for things that have changed
 * since: how the player is playing, and how old he now is.
 */
export function transferValue(
  player: EnginePlayer,
  baseValueEur: number | null,
  potential: number,
): number {
  // Some rows have no value at all. Falling back to something derived from
  // overall keeps every player tradeable rather than free.
  const base =
    baseValueEur && baseValueEur > 0
      ? baseValueEur
      : Math.round(Math.pow(Math.max(40, player.overall) / 10, 4.2) * 900);

  const formFactor = 1 + ((player.form - 6.5) / 2) * TRANSFER.formSwing;

  const room = Math.max(0, potential - player.overall);
  const youth = player.age <= 23 ? Math.min(1, room / 8) : 0;
  const potentialFactor = 1 + youth * TRANSFER.potentialPremium;

  return Math.round(base * Math.max(0.5, formFactor) * potentialFactor);
}

/**
 * What a club will actually take for a player.
 *
 * `importance` is how central he is to the side, from 0 for someone who never
 * plays to 1 for the first name on the team sheet. It is the difference
 * between a squad player and an untouchable, and it is the main reason a club
 * can refuse a bid well above market value.
 */
export function askingPrice(
  rng: RngState,
  value: number,
  importance: number,
  options: { unwanted?: boolean } = {},
): number {
  const premium =
    TRANSFER.basePremium +
    importance * TRANSFER.keyPlayerPremium -
    (options.unwanted ? TRANSFER.fringeDiscount : 0);

  const noise = randRange(rng, 1 - TRANSFER.priceNoise, 1 + TRANSFER.priceNoise);
  return Math.max(100_000, Math.round(value * Math.max(0.6, premium) * noise));
}

/* -------------------------------------------------------------- negotiating */

export type BidVerdict =
  | { decision: "accept" }
  | { decision: "counter"; counterFee: number; reason: string }
  | { decision: "reject"; reason: string };

/**
 * The asking price after the club's willingness to sell is taken into account.
 *
 * A keen seller shades its price; a reluctant one holds out above it. This has
 * to be exported and used by whatever shows a price to the manager, not just by
 * the evaluation: if the screen shows the raw valuation while the decision is
 * made against this, then bidding exactly what was asked gets countered, and
 * the manager is being lied to by the interface.
 */
export function askingAfterAppetite(asking: number, appetite: number): number {
  return Math.round(asking * (1.15 - Math.max(0, Math.min(1, appetite)) * 0.3));
}

/**
 * Whether a club takes the money.
 *
 * `appetite` is how willing this club is to sell at all: a club over its squad
 * limit or short of money will take less, and one with no need to sell holds
 * out. A club below the minimum squad size refuses outright, which is what
 * stops the AI selling itself down to nine players.
 */
export function evaluateBid(
  bid: number,
  asking: number,
  options: {
    appetite?: number;
    sellerSquadSize: number;
    buyerSquadSize: number;
    buyerBudget: number;
  },
): BidVerdict {
  const { appetite = 0.5, sellerSquadSize, buyerSquadSize, buyerBudget } = options;

  if (bid > buyerBudget) {
    return { decision: "reject", reason: "You cannot afford that fee" };
  }
  if (sellerSquadSize <= TRANSFER.minSquadSize) {
    return { decision: "reject", reason: "They are too short of numbers to sell" };
  }
  if (buyerSquadSize >= TRANSFER.maxSquadSize) {
    return { decision: "reject", reason: `Your squad is already at ${TRANSFER.maxSquadSize} players` };
  }

  const effectiveAsking = askingAfterAppetite(asking, appetite);

  if (bid >= effectiveAsking) return { decision: "accept" };

  if (bid >= effectiveAsking * TRANSFER.counterThreshold) {
    const counterFee = Math.round(
      bid + (effectiveAsking - bid) * TRANSFER.counterLean,
    );
    return {
      decision: "counter",
      counterFee,
      reason: "They want more, but they are willing to talk",
    };
  }

  return { decision: "reject", reason: "The bid was nowhere near their valuation" };
}

/* -------------------------------------------------------------------- wages */

/**
 * What a player wants to sign.
 *
 * Moving to a stronger side is worth a pay cut and moving to a weaker one is
 * not, which is the mechanism that stops a mid-table club buying whoever it
 * likes the moment it has the cash.
 */
export function playerWageDemand(
  currentWageEur: number | null,
  currentClubStrength: number,
  suitorStrength: number,
): number {
  const base = currentWageEur && currentWageEur > 0 ? currentWageEur : 20_000;
  const step = (suitorStrength - currentClubStrength) / TRANSFER.stepRatingSpan;

  const adjustment =
    step >= 0
      ? -Math.min(1, step) * TRANSFER.stepUpWageDiscount
      : Math.min(1.6, -step) * TRANSFER.stepDownWagePenalty;

  return Math.max(1_000, Math.round(base * (TRANSFER.baseWageDemand + adjustment)));
}

export type WageVerdict =
  | { decision: "accept" }
  | { decision: "reject"; reason: string; demand: number };

/**
 * Whether the player signs. A big enough drop in level is refused at any wage:
 * there is a point past which money genuinely does not persuade a player, and
 * without it a relegation candidate could buy a title winner's whole midfield.
 */
export function wageAcceptance(
  offeredWageEur: number,
  demand: number,
  currentClubStrength: number,
  suitorStrength: number,
): WageVerdict {
  if (currentClubStrength - suitorStrength > TRANSFER.maxStepDown) {
    return {
      decision: "reject",
      reason: "He has no interest in dropping to a club at this level",
      demand,
    };
  }

  if (offeredWageEur >= demand) return { decision: "accept" };

  return {
    decision: "reject",
    reason: "The wages are not enough for him",
    demand,
  };
}

/* --------------------------------------------------------------- squad need */

export type SquadNeed = {
  byGroup: Record<PositionGroup, { count: number; quality: number; shortfall: number }>;
  /** Groups the squad is thinnest in, worst first. */
  priority: PositionGroup[];
  /** True when the squad is below the minimum and must sign someone. */
  mustBuy: boolean;
  /** True when the squad is over the cap and must move players on. */
  mustSell: boolean;
};

/**
 * Where a squad is thin.
 *
 * Depth and quality are both counted: a club with five centre backs who are all
 * poor has a defensive need even though it has the bodies. Quality is measured
 * against the squad's own standard rather than an absolute, so a strong club
 * looking to improve and a weak one looking to survive both get sensible
 * answers.
 */
export function squadNeed(squad: EnginePlayer[]): SquadNeed {
  const groups: PositionGroup[] = ["GK", "DEF", "MID", "ATT"];
  const byGroup = {} as SquadNeed["byGroup"];

  const squadStandard =
    squad.length > 0
      ? squad
          .slice()
          .sort((a, b) => b.overall - a.overall)
          .slice(0, 16)
          .reduce((sum, p) => sum + p.overall, 0) / Math.min(16, squad.length)
      : 60;

  for (const group of groups) {
    const members = squad.filter((p) => groupOf(p) === group);
    const best = members
      .slice()
      .sort((a, b) => b.overall - a.overall)
      .slice(0, TARGET_DEPTH[group]);

    const quality =
      best.length > 0 ? best.reduce((sum, p) => sum + p.overall, 0) / best.length : 40;

    // Missing bodies and below-standard bodies both count, the former harder.
    const missing = Math.max(0, TARGET_DEPTH[group] - members.length);
    const qualityGap = Math.max(0, squadStandard - quality);
    const shortfall = missing * 1.5 + qualityGap * 0.35;

    byGroup[group] = { count: members.length, quality: Math.round(quality), shortfall };
  }

  return {
    byGroup,
    priority: groups.slice().sort((a, b) => byGroup[b].shortfall - byGroup[a].shortfall),
    mustBuy: squad.length < TRANSFER.minSquadSize,
    mustSell: squad.length > TRANSFER.maxSquadSize,
  };
}

/**
 * How keen a club is to do business, from 0 to 1.
 *
 * Used both ways: a club with a high appetite sells more readily and also bids
 * more aggressively, which is roughly how a club in the middle of a rebuild
 * actually behaves.
 */
export function clubTransferAppetite(
  need: SquadNeed,
  budget: number,
  squadSize: number,
): number {
  let appetite = 0.4;

  if (need.mustSell) appetite += 0.35;
  if (need.mustBuy) appetite -= 0.2;
  if (squadSize > TRANSFER.maxSquadSize - 3) appetite += 0.15;
  if (squadSize < TRANSFER.minSquadSize + 3) appetite -= 0.15;
  // A club with nothing to spend is likelier to listen to offers.
  if (budget < 5_000_000) appetite += 0.15;

  return Math.max(0, Math.min(1, appetite));
}

/** A player an AI club has decided it wants, with how much it rates the fit. */
export type TransferTarget = {
  playerId: number;
  clubId: number;
  /** How much better this player is than what the buyer already has. */
  upgrade: number;
  group: PositionGroup;
};
