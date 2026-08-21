/**
 * The transfer market.
 *
 * A deal is not a purchase, it is a conversation that takes time and can fall
 * over at any point. A bid is made, the selling club answers a round later with
 * a yes, a no or a number of its own, and only then does the player decide
 * whether he fancies it. That delay is the whole point: it is what makes a
 * window feel like a window rather than a shop, and what lets a rival get there
 * first while you are still haggling.
 *
 * The AI clubs use exactly the same code path. They bid for each other's
 * players and for the manager's, and their offers arrive in the manager's inbox
 * as decisions to make. Nothing here is special-cased for the human.
 */

import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  careerClubFinance,
  careerPlayerState,
  clubs,
  players,
  transferHistory,
  transferOffers,
  type PlayerRow,
  type TransferOfferRow,
} from "@/db/schema";
import {
  TRANSFER,
  askingAfterAppetite,
  askingPrice,
  clubTransferAppetite,
  createRng,
  evaluateBid,
  hash32,
  playerWageDemand,
  randInt,
  shuffle,
  squadNeed,
  squadStrength,
  transferValue,
  wageAcceptance,
  type EnginePlayer,
} from "@/engine";
import { toEnginePlayer } from "./engineAdapter";
import { weeklyWage } from "./careerService";
import { PL_CLUB_IDS } from "@/data/clubs";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/* ------------------------------------------------------------------ windows */

export type TransferWindow = {
  open: boolean;
  name: "summer" | "january" | null;
  /** Last round of the window, so the screen can count down to the deadline. */
  closesAfterRound: number | null;
  /** Rounds left including this one. */
  roundsRemaining: number;
  /** The next window's opening round, when none is open. */
  opensOnRound: number | null;
};

export function transferWindow(round: number): TransferWindow {
  const [summerFrom, summerTo] = TRANSFER.summerWindow;
  const [janFrom, janTo] = TRANSFER.januaryWindow;

  if (round >= summerFrom && round <= summerTo) {
    return {
      open: true,
      name: "summer",
      closesAfterRound: summerTo,
      roundsRemaining: summerTo - round + 1,
      opensOnRound: null,
    };
  }

  if (round >= janFrom && round <= janTo) {
    return {
      open: true,
      name: "january",
      closesAfterRound: janTo,
      roundsRemaining: janTo - round + 1,
      opensOnRound: null,
    };
  }

  return {
    open: false,
    name: null,
    closesAfterRound: null,
    roundsRemaining: 0,
    opensOnRound: round < janFrom ? janFrom : null,
  };
}

/* ---------------------------------------------------------------- finances */

export async function loadFinance(careerId: string, clubId: number) {
  const rows = await db
    .select()
    .from(careerClubFinance)
    .where(
      and(eq(careerClubFinance.careerId, careerId), eq(careerClubFinance.clubId, clubId)),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function loadAllFinances(tx: Tx, careerId: string) {
  const rows = await tx
    .select()
    .from(careerClubFinance)
    .where(eq(careerClubFinance.careerId, careerId));
  return new Map(rows.map((r) => [r.clubId, r]));
}

/* ------------------------------------------------------------ market shapes */

type MarketPlayer = {
  row: PlayerRow;
  engine: EnginePlayer;
  clubId: number;
  wage: number;
  /** Set once the board has agreed to sell him. See listPlayerForSale below. */
  listedForSale: boolean;
};

/** Every player in the career, grouped by the club they currently play for. */
async function loadMarket(
  tx: Tx | typeof db,
  careerId: string,
): Promise<{ all: MarketPlayer[]; byClub: Map<number, MarketPlayer[]> }> {
  const rows = await tx
    .select({ player: players, state: careerPlayerState })
    .from(players)
    .innerJoin(
      careerPlayerState,
      and(
        eq(careerPlayerState.playerId, players.id),
        eq(careerPlayerState.careerId, careerId),
      ),
    );

  const all = rows.map(({ player, state }) => ({
    row: player,
    engine: toEnginePlayer(player, state),
    clubId: state.clubId ?? player.clubId,
    wage: weeklyWage(player),
    listedForSale: state.listedForSale,
  }));

  const byClub = new Map<number, MarketPlayer[]>();
  for (const entry of all) {
    const list = byClub.get(entry.clubId) ?? [];
    list.push(entry);
    byClub.set(entry.clubId, list);
  }

  return { all, byClub };
}

/**
 * How central a player is to his club, from 0 to 1.
 *
 * Judged by where he ranks in his own squad rather than by an absolute rating,
 * so a good player at a great club is correctly treated as replaceable while
 * the same player would be untouchable further down the table.
 */
function importanceOf(player: MarketPlayer, squad: MarketPlayer[]): number {
  const ranked = squad.slice().sort((a, b) => b.engine.overall - a.engine.overall);
  const rank = ranked.findIndex((p) => p.row.id === player.row.id);
  if (rank === -1) return 0.5;
  return Math.max(0, 1 - rank / 14);
}

/**
 * The price a club has put on a player this round.
 *
 * Seeded from the career, the player and the round so the figure is stable
 * while the manager is looking at it and moves between windows. A price that
 * changed on every page load would be unusable.
 */
function priceFor(
  careerId: string,
  round: number,
  player: MarketPlayer,
  squad: MarketPlayer[],
): number {
  const rng = createRng(hash32(`${careerId}-price-${player.row.id}-${round}`));
  const value = transferValue(player.engine, player.row.valueEur, player.row.potential);
  const importance = importanceOf(player, squad);
  // A player the board has agreed to sell prices the same as any other fringe
  // player the club is glad to be rid of, regardless of how central he is to
  // the side: the whole point of asking was to move him on.
  return askingPrice(rng, value, importance, {
    unwanted: importance < 0.12 || player.listedForSale,
  });
}

/**
 * The number to put in front of a bidder: the valuation, adjusted for how
 * willing the club actually is to sell.
 *
 * `priceFor` deliberately stays raw because `evaluateBid` applies the appetite
 * itself, and passing an already-adjusted figure into it would apply the
 * adjustment twice. Anything that displays a price, or that bids one, uses this
 * instead, so what the manager is quoted is what will actually be accepted.
 */
function quotedPriceFor(
  careerId: string,
  round: number,
  player: MarketPlayer,
  squad: MarketPlayer[],
  budget: number,
): number {
  const raw = priceFor(careerId, round, player, squad);
  const appetite = clubTransferAppetite(
    squadNeed(squad.map((p) => p.engine)),
    budget,
    squad.length,
  );
  return askingAfterAppetite(raw, appetite);
}

export type TransferTargetView = {
  playerId: number;
  name: string;
  clubId: number;
  clubName: string;
  positions: string[];
  age: number;
  overall: number;
  potential: number;
  form: number;
  value: number;
  askingPrice: number;
  wageDemand: number;
  /** Set when this club already has a bid in for him. */
  existingOfferStatus: string | null;
};

/**
 * Players the manager could try to sign, with what they would cost.
 *
 * Own players are excluded, and so is anyone at a club already down to the
 * minimum squad size, since a bid for them would be refused out of hand.
 */
export async function listTargets(
  careerId: string,
  userClubId: number,
  round: number,
  options: { search?: string; maxFee?: number; limit?: number } = {},
): Promise<TransferTargetView[]> {
  const { byClub } = await loadMarket(db, careerId);
  const clubRows = await db.select().from(clubs);
  const clubName = new Map(clubRows.map((c) => [c.id, c.name]));

  const financeRows = await db
    .select()
    .from(careerClubFinance)
    .where(eq(careerClubFinance.careerId, careerId));
  const budgets = new Map(financeRows.map((r) => [r.clubId, r.transferBudget]));

  const ourSquad = byClub.get(userClubId) ?? [];
  const ourStrength = squadStrength(ourSquad.map((p) => p.engine));

  const existing = await db
    .select({ playerId: transferOffers.playerId, status: transferOffers.status })
    .from(transferOffers)
    .where(
      and(
        eq(transferOffers.careerId, careerId),
        eq(transferOffers.toClubId, userClubId),
        inArray(transferOffers.status, ["pending", "countered", "agreed"]),
      ),
    );
  const offerStatus = new Map(existing.map((o) => [o.playerId, o.status]));

  const search = options.search?.trim().toLowerCase();
  const out: TransferTargetView[] = [];

  for (const [clubId, squad] of byClub) {
    if (clubId === userClubId) continue;
    if (squad.length <= TRANSFER.minSquadSize) continue;

    const sellerStrength = squadStrength(squad.map((p) => p.engine));

    for (const player of squad) {
      if (search && !player.row.longName.toLowerCase().includes(search)) continue;

      const fee = quotedPriceFor(careerId, round, player, squad, budgets.get(clubId) ?? 0);
      if (options.maxFee !== undefined && fee > options.maxFee) continue;

      out.push({
        playerId: player.row.id,
        name: player.row.shortName,
        clubId,
        clubName: clubName.get(clubId) ?? "Unknown",
        positions: player.row.positions,
        age: player.row.age,
        overall: player.engine.overall,
        potential: player.row.potential,
        form: player.engine.form,
        value: transferValue(player.engine, player.row.valueEur, player.row.potential),
        askingPrice: fee,
        wageDemand: playerWageDemand(player.wage, sellerStrength, ourStrength),
        existingOfferStatus: offerStatus.get(player.row.id) ?? null,
      });
    }
  }

  out.sort((a, b) => b.overall - a.overall);
  return out.slice(0, options.limit ?? 60);
}

/* ------------------------------------------------------------ making offers */

export type OfferOutcome = { ok: true; offerId: string } | { ok: false; error: string };

/**
 * Puts in a bid. The offer is recorded rather than resolved: the selling club
 * answers next round.
 */
export async function makeOffer(
  careerId: string,
  userClubId: number,
  round: number,
  playerId: number,
  feeEur: number,
  wageEur: number,
): Promise<OfferOutcome> {
  const window = transferWindow(round);
  if (!window.open) return { ok: false, error: "The transfer window is shut" };
  if (!Number.isFinite(feeEur) || feeEur <= 0) return { ok: false, error: "That is not a fee" };
  if (!Number.isFinite(wageEur) || wageEur <= 0) return { ok: false, error: "That is not a wage" };

  return db.transaction(async (tx) => {
    const { byClub } = await loadMarket(tx, careerId);
    const target = [...byClub.values()].flat().find((p) => p.row.id === playerId);
    if (!target) return { ok: false, error: "No such player" };
    if (target.clubId === userClubId) return { ok: false, error: "He already plays for you" };

    const ourSquad = byClub.get(userClubId) ?? [];
    if (ourSquad.length >= TRANSFER.maxSquadSize) {
      return { ok: false, error: `Your squad is already at ${TRANSFER.maxSquadSize} players` };
    }

    const finance = (await loadAllFinances(tx, careerId)).get(userClubId);
    if (!finance) return { ok: false, error: "No budget on record" };
    if (feeEur > finance.transferBudget) {
      return { ok: false, error: "That is more than your transfer budget" };
    }

    // Wages already committed elsewhere have to leave room for this one.
    const wageRoom = finance.wageBudget - finance.wageSpend;
    if (wageEur > wageRoom) {
      return { ok: false, error: "You have no room in the wage budget for that" };
    }

    const duplicate = await tx
      .select({ id: transferOffers.id })
      .from(transferOffers)
      .where(
        and(
          eq(transferOffers.careerId, careerId),
          eq(transferOffers.playerId, playerId),
          eq(transferOffers.toClubId, userClubId),
          inArray(transferOffers.status, ["pending", "countered", "agreed"]),
        ),
      )
      .limit(1);

    if (duplicate.length > 0) {
      return { ok: false, error: "You already have a bid in for him" };
    }

    const [offer] = await tx
      .insert(transferOffers)
      .values({
        careerId,
        playerId,
        fromClubId: target.clubId,
        toClubId: userClubId,
        isUserOffer: true,
        feeEur: Math.round(feeEur),
        wageEur: Math.round(wageEur),
        round,
        resolvesOnRound: round + TRANSFER.responseDelay,
      })
      .returning({ id: transferOffers.id });

    return { ok: true, offerId: offer.id };
  });
}

/** Pulls a bid before it resolves. */
export async function withdrawOffer(careerId: string, offerId: string): Promise<void> {
  await db
    .update(transferOffers)
    .set({ status: "withdrawn" })
    .where(
      and(
        eq(transferOffers.careerId, careerId),
        eq(transferOffers.id, offerId),
        inArray(transferOffers.status, ["pending", "countered"]),
      ),
    );
}

/**
 * Takes a selling club up on its counter offer.
 *
 * This completes immediately rather than waiting another round. The club named
 * the number itself, so there is nothing left for it to think about, and making
 * the manager wait again for a price the seller already proposed would be
 * needless friction.
 */
export async function acceptCounter(
  careerId: string,
  offerId: string,
  round: number,
): Promise<{ ok: boolean; message: string }> {
  return db.transaction(async (tx) => {
    const [offer] = await tx
      .select()
      .from(transferOffers)
      .where(
        and(
          eq(transferOffers.careerId, careerId),
          eq(transferOffers.id, offerId),
          eq(transferOffers.status, "countered"),
        ),
      )
      .limit(1);

    if (!offer || offer.counterFeeEur === null) {
      return { ok: false, message: "That offer is no longer open" };
    }

    const finances = await loadAllFinances(tx, careerId);
    const buyer = finances.get(offer.toClubId);
    if (!buyer || offer.counterFeeEur > buyer.transferBudget) {
      await tx
        .update(transferOffers)
        .set({ status: "rejected", responseNote: "You could not afford their counter" })
        .where(eq(transferOffers.id, offer.id));
      return { ok: false, message: "You cannot afford their counter" };
    }

    const settled = await settleOffer(tx, careerId, { ...offer, feeEur: offer.counterFeeEur }, round);
    return { ok: settled.completed, message: settled.note };
  });
}

/** The manager's answer to a bid for one of his own players. */
export async function respondToIncoming(
  careerId: string,
  offerId: string,
  accept: boolean,
  round: number,
): Promise<{ ok: boolean; message: string }> {
  return db.transaction(async (tx) => {
    const [offer] = await tx
      .select()
      .from(transferOffers)
      .where(
        and(
          eq(transferOffers.careerId, careerId),
          eq(transferOffers.id, offerId),
          eq(transferOffers.status, "pending"),
        ),
      )
      .limit(1);

    if (!offer) return { ok: false, message: "That offer is no longer open" };

    if (!accept) {
      await tx
        .update(transferOffers)
        .set({ status: "rejected", responseNote: "You turned it down" })
        .where(eq(transferOffers.id, offer.id));
      return { ok: true, message: "Offer rejected" };
    }

    const settled = await settleOffer(tx, careerId, offer, round);
    return { ok: settled.completed, message: settled.note };
  });
}

/* ------------------------------------------------------------- completing */

/**
 * Carries out an agreed deal, if the player will have it.
 *
 * The wage check happens here rather than when the bid is made, because it is
 * the last thing to go wrong in a real transfer and the most interesting: the
 * clubs agree, and then the player says no.
 */
async function settleOffer(
  tx: Tx,
  careerId: string,
  offer: TransferOfferRow,
  round: number,
): Promise<{ completed: boolean; note: string }> {
  const { byClub } = await loadMarket(tx, careerId);
  const sellerSquad = byClub.get(offer.fromClubId) ?? [];
  const buyerSquad = byClub.get(offer.toClubId) ?? [];
  const player = sellerSquad.find((p) => p.row.id === offer.playerId);

  if (!player) {
    await tx
      .update(transferOffers)
      .set({ status: "rejected", responseNote: "He has already gone elsewhere" })
      .where(eq(transferOffers.id, offer.id));
    return { completed: false, note: "He has already gone elsewhere" };
  }

  if (sellerSquad.length <= TRANSFER.minSquadSize) {
    await tx
      .update(transferOffers)
      .set({ status: "rejected", responseNote: "They are too short of numbers to sell" })
      .where(eq(transferOffers.id, offer.id));
    return { completed: false, note: "They are too short of numbers to sell" };
  }

  if (buyerSquad.length >= TRANSFER.maxSquadSize) {
    await tx
      .update(transferOffers)
      .set({ status: "rejected", responseNote: "The buying squad is full" })
      .where(eq(transferOffers.id, offer.id));
    return { completed: false, note: "The buying squad is full" };
  }

  const sellerStrength = squadStrength(sellerSquad.map((p) => p.engine));
  const buyerStrength = squadStrength(buyerSquad.map((p) => p.engine));
  const demand = playerWageDemand(player.wage, sellerStrength, buyerStrength);
  const verdict = wageAcceptance(offer.wageEur, demand, sellerStrength, buyerStrength);

  if (verdict.decision === "reject") {
    await tx
      .update(transferOffers)
      .set({
        status: "player_refused",
        responseNote: `${verdict.reason}. He wants ${formatEur(verdict.demand)} a week.`,
      })
      .where(eq(transferOffers.id, offer.id));
    return { completed: false, note: verdict.reason };
  }

  await transferPlayer(tx, careerId, offer, player, round);

  await tx
    .update(transferOffers)
    .set({ status: "accepted", responseNote: "Deal done" })
    .where(eq(transferOffers.id, offer.id));

  return { completed: true, note: "Deal done" };
}

/** Moves the player and settles up. */
async function transferPlayer(
  tx: Tx,
  careerId: string,
  offer: TransferOfferRow,
  player: MarketPlayer,
  round: number,
): Promise<void> {
  await tx
    .update(careerPlayerState)
    .set({ clubId: offer.toClubId, listedForSale: false })
    .where(
      and(
        eq(careerPlayerState.careerId, careerId),
        eq(careerPlayerState.playerId, offer.playerId),
      ),
    );

  await tx
    .update(careerClubFinance)
    .set({
      transferBudget: sql`${careerClubFinance.transferBudget} - ${offer.feeEur}`,
      wageSpend: sql`${careerClubFinance.wageSpend} + ${offer.wageEur}`,
    })
    .where(
      and(
        eq(careerClubFinance.careerId, careerId),
        eq(careerClubFinance.clubId, offer.toClubId),
      ),
    );

  await tx
    .update(careerClubFinance)
    .set({
      transferBudget: sql`${careerClubFinance.transferBudget} + ${offer.feeEur}`,
      wageSpend: sql`GREATEST(0, ${careerClubFinance.wageSpend} - ${player.wage})`,
    })
    .where(
      and(
        eq(careerClubFinance.careerId, careerId),
        eq(careerClubFinance.clubId, offer.fromClubId),
      ),
    );

  await tx.insert(transferHistory).values({
    careerId,
    playerId: offer.playerId,
    fromClubId: offer.fromClubId,
    toClubId: offer.toClubId,
    feeEur: offer.feeEur,
    round,
  });

  // Any other live bid for the same player is now dead.
  await tx
    .update(transferOffers)
    .set({ status: "rejected", responseNote: "He signed for somebody else" })
    .where(
      and(
        eq(transferOffers.careerId, careerId),
        eq(transferOffers.playerId, offer.playerId),
        ne(transferOffers.id, offer.id),
        inArray(transferOffers.status, ["pending", "countered", "agreed"]),
      ),
    );
}

/* ----------------------------------------------------------- the round tick */

/**
 * Advances the market by one round: answers the offers that are due, then lets
 * the AI clubs go shopping.
 *
 * Called as part of settling a round, inside the same transaction, so a career
 * can never end up with a half-completed transfer.
 */
export async function processTransferRound(
  tx: Tx,
  careerId: string,
  userClubId: number,
  round: number,
): Promise<void> {
  const window = transferWindow(round);

  // Offers are answered first, whether or not the window is still open. A bid
  // placed on the last day of the window is answered the round after, by which
  // point the window has shut; refusing to settle it would mean no deadline day
  // deal could ever go through.
  await respondToDueOffers(tx, careerId, userClubId, round);

  if (!window.open) {
    // Anything that has still not resolved lapses with the window.
    await tx
      .update(transferOffers)
      .set({ status: "expired", responseNote: "The window shut before this was settled" })
      .where(
        and(
          eq(transferOffers.careerId, careerId),
          inArray(transferOffers.status, ["pending", "countered", "agreed"]),
        ),
      );
    return;
  }

  await runAiMarket(tx, careerId, userClubId, round);
  await runListedPlayerInterest(tx, careerId, userClubId, round);
}

/** Selling clubs answer the bids that have been sitting on their desk. */
async function respondToDueOffers(
  tx: Tx,
  careerId: string,
  userClubId: number,
  round: number,
): Promise<void> {
  const due = await tx
    .select()
    .from(transferOffers)
    .where(
      and(
        eq(transferOffers.careerId, careerId),
        eq(transferOffers.status, "pending"),
        sql`${transferOffers.resolvesOnRound} <= ${round}`,
      ),
    )
    .orderBy(asc(transferOffers.createdAt));

  if (due.length === 0) return;

  const finances = await loadAllFinances(tx, careerId);

  for (const offer of due) {
    // A bid for one of the manager's players is his to answer, not the
    // simulation's. It sits in his inbox until he does.
    if (offer.fromClubId === userClubId) continue;

    const { byClub } = await loadMarket(tx, careerId);
    const sellerSquad = byClub.get(offer.fromClubId) ?? [];
    const buyerSquad = byClub.get(offer.toClubId) ?? [];
    const player = sellerSquad.find((p) => p.row.id === offer.playerId);

    if (!player) {
      await tx
        .update(transferOffers)
        .set({ status: "rejected", responseNote: "He has already gone elsewhere" })
        .where(eq(transferOffers.id, offer.id));
      continue;
    }

    const asking = priceFor(careerId, offer.round, player, sellerSquad);
    const need = squadNeed(sellerSquad.map((p) => p.engine));
    const sellerFinance = finances.get(offer.fromClubId);
    const buyerFinance = finances.get(offer.toClubId);

    const verdict = evaluateBid(offer.feeEur, asking, {
      appetite: clubTransferAppetite(need, sellerFinance?.transferBudget ?? 0, sellerSquad.length),
      sellerSquadSize: sellerSquad.length,
      buyerSquadSize: buyerSquad.length,
      buyerBudget: buyerFinance?.transferBudget ?? 0,
    });

    if (verdict.decision === "accept") {
      await settleOffer(tx, careerId, offer, round);
      continue;
    }

    if (verdict.decision === "counter") {
      // An AI buyer decides on the spot whether the counter is worth paying.
      if (!offer.isUserOffer) {
        const affordable = verdict.counterFee <= (buyerFinance?.transferBudget ?? 0);
        const worthIt = verdict.counterFee <= asking * (1 + TRANSFER.aiMaxOverpay);
        if (affordable && worthIt) {
          await settleOffer(tx, careerId, { ...offer, feeEur: verdict.counterFee }, round);
        } else {
          await tx
            .update(transferOffers)
            .set({ status: "rejected", responseNote: "They would not meet the asking price" })
            .where(eq(transferOffers.id, offer.id));
        }
        continue;
      }

      await tx
        .update(transferOffers)
        .set({
          status: "countered",
          counterFeeEur: verdict.counterFee,
          responseNote: `${verdict.reason}. They want ${formatEur(verdict.counterFee)}.`,
        })
        .where(eq(transferOffers.id, offer.id));
      continue;
    }

    await tx
      .update(transferOffers)
      .set({ status: "rejected", responseNote: verdict.reason })
      .where(eq(transferOffers.id, offer.id));
  }
}

/**
 * The rest of the division does its business.
 *
 * Each club looks at where it is thin, picks the best player it can afford who
 * would improve that area, and bids. It will bid for the manager's players on
 * exactly the same terms, which is where the incoming offers come from.
 */
async function runAiMarket(
  tx: Tx,
  careerId: string,
  userClubId: number,
  round: number,
): Promise<void> {
  const rng = createRng(hash32(`${careerId}-market-${round}`));
  const { byClub } = await loadMarket(tx, careerId);
  const finances = await loadAllFinances(tx, careerId);

  const live = await tx
    .select({ playerId: transferOffers.playerId, toClubId: transferOffers.toClubId })
    .from(transferOffers)
    .where(
      and(
        eq(transferOffers.careerId, careerId),
        inArray(transferOffers.status, ["pending", "countered", "agreed"]),
      ),
    );
  const alreadyBid = new Set(live.map((o) => `${o.toClubId}:${o.playerId}`));

  const pending: (typeof transferOffers.$inferInsert)[] = [];

  // A couple of clubs act each round rather than all twenty, so the window has
  // a rhythm to it instead of twenty deals landing at once.
  const active = shuffle(rng, PL_CLUB_IDS.filter((id) => id !== userClubId)).slice(0, 5);

  for (const clubId of active) {
    const squad = byClub.get(clubId) ?? [];
    const finance = finances.get(clubId);
    if (!finance || squad.length >= TRANSFER.maxSquadSize) continue;

    const need = squadNeed(squad.map((p) => p.engine));
    const wanted = need.priority[0];
    const ourStrength = squadStrength(squad.map((p) => p.engine));

    // What the club already has in that area, to judge an upgrade against.
    const incumbent = squad
      .filter((p) => groupMatches(p, wanted))
      .sort((a, b) => b.engine.overall - a.engine.overall)[0];
    const bar = incumbent ? incumbent.engine.overall : 60;

    const candidates: { player: MarketPlayer; fee: number; sellerSquad: MarketPlayer[] }[] = [];

    for (const [otherId, otherSquad] of byClub) {
      if (otherId === clubId) continue;
      if (otherSquad.length <= TRANSFER.minSquadSize) continue;

      for (const player of otherSquad) {
        if (!groupMatches(player, wanted)) continue;
        if (player.engine.overall <= bar) continue;
        if (alreadyBid.has(`${clubId}:${player.row.id}`)) continue;

        // The AI bids the quoted price, so its offers are accepted rather than
        // endlessly countered.
        const fee = quotedPriceFor(
          careerId,
          round,
          player,
          otherSquad,
          finances.get(otherId)?.transferBudget ?? 0,
        );
        if (fee > finance.transferBudget) continue;

        const demand = playerWageDemand(
          player.wage,
          squadStrength(otherSquad.map((p) => p.engine)),
          ourStrength,
        );
        if (demand > finance.wageBudget - finance.wageSpend) continue;

        candidates.push({ player, fee, sellerSquad: otherSquad });
      }
    }

    if (candidates.length === 0) continue;

    // Best available upgrade, with a little noise so the same club does not
    // chase the identical player every single round.
    candidates.sort((a, b) => b.player.engine.overall - a.player.engine.overall);
    const pick = candidates[randInt(rng, 0, Math.min(4, candidates.length - 1))];

    const sellerStrength = squadStrength(pick.sellerSquad.map((p) => p.engine));
    const wage = playerWageDemand(pick.player.wage, sellerStrength, ourStrength);

    pending.push({
      careerId,
      playerId: pick.player.row.id,
      fromClubId: pick.player.clubId,
      toClubId: clubId,
      isUserOffer: false,
      feeEur: pick.fee,
      wageEur: wage,
      round,
      resolvesOnRound: round + TRANSFER.responseDelay,
    });

    alreadyBid.add(`${clubId}:${pick.player.row.id}`);
  }

  if (pending.length > 0) await tx.insert(transferOffers).values(pending);
}

const GROUPS: Record<string, string[]> = {
  GK: ["GK"],
  DEF: ["CB", "LB", "RB", "LWB", "RWB"],
  MID: ["CDM", "CM", "CAM", "LM", "RM"],
  ATT: ["LW", "RW", "CF", "ST"],
};

function groupMatches(player: MarketPlayer, group: string): boolean {
  const list = GROUPS[group] ?? [];
  return player.row.positions.some((p) => list.includes(p));
}

/* ------------------------------------------------------------ board sales */

/**
 * One AI club willing to take a specific player right now, chosen from
 * whichever clubs can afford him.
 *
 * Unlike `runAiMarket`'s search, this does not require the player to be a
 * club's single biggest priority: a listed player is openly for sale and
 * priced accordingly (see `priceFor`'s `listedForSale` check), so an
 * opportunistic move from a club with room in that position is plausible even
 * when it is not their top need. `excludeClubIds` keeps a player from getting
 * a second offer from a club that already has one in for him.
 */
function findBuyerFor(
  careerId: string,
  userClubId: number,
  player: MarketPlayer,
  sellerSquad: MarketPlayer[],
  byClub: Map<number, MarketPlayer[]>,
  finances: Map<number, { transferBudget: number; wageBudget: number; wageSpend: number }>,
  round: number,
  excludeClubIds: Set<number>,
): { clubId: number; feeEur: number; wageEur: number } | null {
  const sellerStrength = squadStrength(sellerSquad.map((p) => p.engine));
  const rng = createRng(hash32(`${careerId}-listing-${player.row.id}-${round}`));

  const candidates: { clubId: number; feeEur: number; wageEur: number }[] = [];

  for (const clubId of PL_CLUB_IDS) {
    if (clubId === userClubId || excludeClubIds.has(clubId)) continue;

    const squad = byClub.get(clubId) ?? [];
    const finance = finances.get(clubId);
    if (!finance || squad.length >= TRANSFER.maxSquadSize) continue;

    const fee = quotedPriceFor(careerId, round, player, sellerSquad, finance.transferBudget);
    if (fee > finance.transferBudget) continue;

    const wage = playerWageDemand(
      player.wage,
      sellerStrength,
      squadStrength(squad.map((p) => p.engine)),
    );
    if (wage > finance.wageBudget - finance.wageSpend) continue;

    candidates.push({ clubId, feeEur: fee, wageEur: wage });
  }

  if (candidates.length === 0) return null;
  return candidates[randInt(rng, 0, candidates.length - 1)];
}

/**
 * Marks a player as available and, if a buyer can be found straight away,
 * puts in an immediate offer rather than making the manager wait for the next
 * round. Called once, right after the board grants a sell request.
 */
export async function listPlayerForSale(
  tx: Tx,
  careerId: string,
  userClubId: number,
  playerId: number,
  round: number,
): Promise<{ immediateOffer: boolean }> {
  await tx
    .update(careerPlayerState)
    .set({ listedForSale: true })
    .where(
      and(eq(careerPlayerState.careerId, careerId), eq(careerPlayerState.playerId, playerId)),
    );

  const { byClub } = await loadMarket(tx, careerId);
  const sellerSquad = byClub.get(userClubId) ?? [];
  const player = sellerSquad.find((p) => p.row.id === playerId);
  if (!player) return { immediateOffer: false };

  const finances = await loadAllFinances(tx, careerId);
  const buyer = findBuyerFor(careerId, userClubId, player, sellerSquad, byClub, finances, round, new Set());
  if (!buyer) return { immediateOffer: false };

  await tx.insert(transferOffers).values({
    careerId,
    playerId,
    fromClubId: userClubId,
    toClubId: buyer.clubId,
    isUserOffer: false,
    feeEur: buyer.feeEur,
    wageEur: buyer.wageEur,
    round,
    resolvesOnRound: round + TRANSFER.responseDelay,
  });

  return { immediateOffer: true };
}

/**
 * The trickle of further interest a listed player draws each round on top of
 * his immediate offer, up to a handful of clubs total. Runs every round a
 * window is open, alongside the ordinary need-driven AI market.
 */
async function runListedPlayerInterest(
  tx: Tx,
  careerId: string,
  userClubId: number,
  round: number,
): Promise<void> {
  const { byClub } = await loadMarket(tx, careerId);
  const listed = (byClub.get(userClubId) ?? []).filter((p) => p.listedForSale);
  if (listed.length === 0) return;

  const finances = await loadAllFinances(tx, careerId);
  const sellerSquad = byClub.get(userClubId) ?? [];

  const offersMade = await tx
    .select({ playerId: transferOffers.playerId, toClubId: transferOffers.toClubId })
    .from(transferOffers)
    .where(
      and(
        eq(transferOffers.careerId, careerId),
        eq(transferOffers.fromClubId, userClubId),
        inArray(
          transferOffers.playerId,
          listed.map((p) => p.row.id),
        ),
      ),
    );

  const pending: (typeof transferOffers.$inferInsert)[] = [];

  for (const player of listed) {
    // Every club that has ever come in for him counts against the cap, not
    // just live offers: three genuine suitors is the ceiling regardless of
    // whether earlier ones were rejected or fell through.
    const interested = new Set(
      offersMade.filter((o) => o.playerId === player.row.id).map((o) => o.toClubId),
    );
    if (interested.size >= TRANSFER.listedMaxSuitors) continue;

    const buyer = findBuyerFor(
      careerId,
      userClubId,
      player,
      sellerSquad,
      byClub,
      finances,
      round,
      interested,
    );
    if (!buyer) continue;

    pending.push({
      careerId,
      playerId: player.row.id,
      fromClubId: userClubId,
      toClubId: buyer.clubId,
      isUserOffer: false,
      feeEur: buyer.feeEur,
      wageEur: buyer.wageEur,
      round,
      resolvesOnRound: round + TRANSFER.responseDelay,
    });
  }

  if (pending.length > 0) await tx.insert(transferOffers).values(pending);
}

/* ---------------------------------------------------------------- listings */

export type OfferView = {
  id: string;
  playerId: number;
  playerName: string;
  fromClubId: number;
  fromClubName: string;
  toClubId: number;
  toClubName: string;
  feeEur: number;
  wageEur: number;
  counterFeeEur: number | null;
  status: string;
  responseNote: string | null;
  round: number;
};

async function decorateOffers(rows: TransferOfferRow[]): Promise<OfferView[]> {
  if (rows.length === 0) return [];

  const [clubRows, playerRows] = await Promise.all([
    db.select().from(clubs),
    db
      .select({ id: players.id, name: players.shortName })
      .from(players)
      .where(inArray(players.id, [...new Set(rows.map((r) => r.playerId))])),
  ]);

  const clubName = new Map(clubRows.map((c) => [c.id, c.name]));
  const playerName = new Map(playerRows.map((p) => [p.id, p.name]));

  return rows.map((row) => ({
    id: row.id,
    playerId: row.playerId,
    playerName: playerName.get(row.playerId) ?? "Unknown",
    fromClubId: row.fromClubId,
    fromClubName: clubName.get(row.fromClubId) ?? "Unknown",
    toClubId: row.toClubId,
    toClubName: clubName.get(row.toClubId) ?? "Unknown",
    feeEur: row.feeEur,
    wageEur: row.wageEur,
    counterFeeEur: row.counterFeeEur,
    status: row.status,
    responseNote: row.responseNote,
    round: row.round,
  }));
}

/** The manager's own bids, live ones first. */
export async function listOutgoingOffers(
  careerId: string,
  userClubId: number,
): Promise<OfferView[]> {
  const rows = await db
    .select()
    .from(transferOffers)
    .where(
      and(
        eq(transferOffers.careerId, careerId),
        eq(transferOffers.toClubId, userClubId),
        eq(transferOffers.isUserOffer, true),
      ),
    )
    .orderBy(desc(transferOffers.createdAt))
    .limit(40);

  return decorateOffers(rows);
}

/** Bids other clubs have made for the manager's players and are waiting on. */
export async function listIncomingOffers(
  careerId: string,
  userClubId: number,
): Promise<OfferView[]> {
  const rows = await db
    .select()
    .from(transferOffers)
    .where(
      and(
        eq(transferOffers.careerId, careerId),
        eq(transferOffers.fromClubId, userClubId),
        eq(transferOffers.status, "pending"),
      ),
    )
    .orderBy(desc(transferOffers.feeEur));

  return decorateOffers(rows);
}

/** Every completed deal in the career, newest first. */
export async function listCompletedTransfers(careerId: string, limit = 30) {
  const rows = await db
    .select({
      id: transferHistory.id,
      playerId: transferHistory.playerId,
      playerName: players.shortName,
      fromClubId: transferHistory.fromClubId,
      toClubId: transferHistory.toClubId,
      feeEur: transferHistory.feeEur,
      round: transferHistory.round,
    })
    .from(transferHistory)
    .innerJoin(players, eq(players.id, transferHistory.playerId))
    .where(eq(transferHistory.careerId, careerId))
    .orderBy(desc(transferHistory.round), desc(transferHistory.id))
    .limit(limit);

  const clubRows = await db.select().from(clubs);
  const clubName = new Map(clubRows.map((c) => [c.id, c.name]));

  return rows.map((r) => ({
    ...r,
    fromClubName: clubName.get(r.fromClubId) ?? "Unknown",
    toClubName: clubName.get(r.toClubId) ?? "Unknown",
  }));
}

/** Money, formatted the way a transfer fee is usually written. */
export function formatEur(amount: number): string {
  if (amount >= 1_000_000) {
    const millions = amount / 1_000_000;
    return `€${millions >= 100 ? Math.round(millions) : millions.toFixed(1)}m`;
  }
  if (amount >= 1_000) return `€${Math.round(amount / 1_000)}k`;
  return `€${Math.round(amount)}`;
}
