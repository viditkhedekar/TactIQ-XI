/**
 * The board, as the game sees it.
 *
 * Gathers the season's evidence, hands it to the pure assessment in
 * `engine/board`, and stores what comes back. Everything judgemental lives in
 * the engine; everything here is fetching and persistence.
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  boardRequests,
  careerClubFinance,
  careerPlayerState,
  careers,
  clubs,
  fixtures,
  jobOffers,
  players,
  seasonHistory,
  transferHistory,
  type BoardRequestRow,
  type CareerRow,
} from "@/db/schema";
import {
  BOARD,
  assessBoard,
  evaluateFundsRequest,
  evaluateSellRequest,
  expectationFromStrength,
  shouldSack,
  squadStrength,
  type BoardView,
  type RequestType,
  type SeasonProgress,
} from "@/engine";
import { toEnginePlayer } from "./engineAdapter";
import { buildLeagueTable, loadDivision } from "./seasonService";
import { cupProgressFor } from "./cupService";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Everything the board is looking at, for one career right now.
 *
 * Assembled from the league table, the cup, the books and the team sheet, then
 * handed to the engine to be judged. It does not write anything: the confidence
 * figure it returns is what the *current* evidence supports, and only
 * `updateBoardConfidence` commits that at the end of a round.
 */
export async function loadBoardView(
  career: CareerRow,
  tx: Tx | typeof db = db,
): Promise<BoardView> {
  const progress = await gatherProgress(career, tx);
  return assessBoard(progress, career.boardConfidence, career.roundsInDanger);
}

/**
 * The raw evidence, before anybody judges it.
 *
 * Takes the same client every query in here runs on. This matters more than it
 * looks: `updateBoardConfidence` calls this from inside the matchday
 * transaction, which in production holds the pool's only connection (see
 * db/client.ts). Every query below used to reach for the module-level `db`
 * instead of that transaction's client, which meant each one tried to check
 * out a second connection from a pool that had none to give — the transaction
 * itself was holding the only one. That is a deadlock, not a slow query, and it
 * surfaced as "timeout exceeded when trying to connect" on every single
 * finish/quick-sim in production, where the local pool's slack (`max: 10`)
 * had been hiding it.
 */
async function gatherProgress(
  career: CareerRow,
  tx: Tx | typeof db = db,
): Promise<SeasonProgress> {
  const table = await buildLeagueTable(career.id, career.season, tx);
  const own = table.find((r) => r.clubId === career.clubId);

  const [finance] = await tx
    .select()
    .from(careerClubFinance)
    .where(
      and(
        eq(careerClubFinance.careerId, career.id),
        eq(careerClubFinance.clubId, career.clubId),
      ),
    )
    .limit(1);

  const cup = await cupProgressFor(career.id, career.season, career.clubId, tx);

  // How the players signed this season are actually performing, which is the
  // board's real question about the transfer budget: not what was spent, but
  // whether it worked.
  const signings = await tx
    .select({
      ratingSum: careerPlayerState.ratingSum,
      ratingCount: careerPlayerState.ratingCount,
    })
    .from(transferHistory)
    .innerJoin(
      careerPlayerState,
      and(
        eq(careerPlayerState.careerId, career.id),
        eq(careerPlayerState.playerId, transferHistory.playerId),
      ),
    )
    .where(
      and(
        eq(transferHistory.careerId, career.id),
        eq(transferHistory.toClubId, career.clubId),
        eq(transferHistory.season, career.season),
      ),
    );

  // What has actually gone out of the door this season, which is the only way
  // to say how much of the budget is left: the starting figure is not stored,
  // so "remaining" has to be measured against what was spent rather than
  // against itself.
  const [spend] = await tx
    .select({ total: sql<number>`COALESCE(SUM(${transferHistory.feeEur}), 0)::bigint` })
    .from(transferHistory)
    .where(
      and(
        eq(transferHistory.careerId, career.id),
        eq(transferHistory.toClubId, career.clubId),
        eq(transferHistory.season, career.season),
      ),
    );

  const spent = Number(spend?.total ?? 0);
  const remaining = finance?.transferBudget ?? 0;

  const ratedSignings = signings.filter((s) => s.ratingCount > 0);
  const signingRating =
    ratedSignings.length > 0
      ? ratedSignings.reduce((sum, s) => sum + s.ratingSum / s.ratingCount, 0) /
        ratedSignings.length
      : null;

  // Minutes given to under-21s, as a share of everything played.
  const squad = await tx
    .select({
      minutes: careerPlayerState.minutes,
      age: sql<number>`COALESCE(${careerPlayerState.age}, ${players.age})`,
    })
    .from(careerPlayerState)
    .innerJoin(players, eq(players.id, careerPlayerState.playerId))
    .where(
      and(
        eq(careerPlayerState.careerId, career.id),
        eq(sql`COALESCE(${careerPlayerState.clubId}, ${players.clubId})`, career.clubId),
      ),
    );

  const totalMinutes = squad.reduce((sum, p) => sum + p.minutes, 0);
  const youthMinutes = squad
    .filter((p) => Number(p.age) <= 21)
    .reduce((sum, p) => sum + p.minutes, 0);

  return {
    position: own?.position ?? table.length,
    expectedPosition: career.expectedPosition,
    clubCount: table.length,
    played: own?.played ?? 0,
    totalRounds: 38,
    cupRoundsWon: cup.roundsWon,
    cupTotalRounds: cup.totalRounds,
    cupWon: cup.won,
    cupGiantKilled: cup.giantKilled,
    budgetRemaining: spent + remaining > 0 ? remaining / (spent + remaining) : 1,
    wagesWithinBudget: finance ? finance.wageSpend <= finance.wageBudget : true,
    signingRating,
    youthMinuteShare: totalMinutes > 0 ? youthMinutes / totalMinutes : 0,
    goalsPerGame: own && own.played > 0 ? own.goalsFor / own.played : 0,
  };
}

/**
 * Recomputes confidence after a round and decides whether the manager survives.
 *
 * Called once per settled round from inside the matchday transaction, so a
 * sacking lands at the same moment as the result that caused it.
 */
export async function updateBoardConfidence(
  tx: Tx,
  career: CareerRow,
): Promise<{ confidence: number; sacked: boolean }> {
  const view = await loadBoardView(career, tx);

  const inDanger = view.confidence < BOARD.sackThreshold;
  const roundsInDanger = inDanger ? career.roundsInDanger + 1 : 0;

  const sacked = shouldSack(view.confidence, roundsInDanger);

  await tx
    .update(careers)
    .set({
      boardConfidence: view.confidence,
      roundsInDanger,
      underPressure: view.underPressure,
      ...(sacked ? { phase: "sacked" } : {}),
      updatedAt: new Date(),
    })
    .where(eq(careers.id, career.id));

  if (sacked) await createJobOffers(tx, career, career.season);

  return { confidence: view.confidence, sacked };
}

/** Sets the board's expectation for a season from squad strength. */
export async function setExpectation(
  tx: Tx,
  careerId: string,
  season: number,
  userClubId: number,
): Promise<number> {
  const division = await loadDivision(careerId, season, tx);

  const rows = await tx
    .select({ player: players, state: careerPlayerState })
    .from(players)
    .innerJoin(
      careerPlayerState,
      and(
        eq(careerPlayerState.playerId, players.id),
        eq(careerPlayerState.careerId, careerId),
      ),
    )
    .where(inArray(sql`COALESCE(${careerPlayerState.clubId}, ${players.clubId})`, division));

  const byClub = new Map<number, ReturnType<typeof toEnginePlayer>[]>();
  for (const { player, state } of rows) {
    const clubId = state.clubId ?? player.clubId;
    const list = byClub.get(clubId) ?? [];
    list.push(toEnginePlayer(player, state));
    byClub.set(clubId, list);
  }

  const strengths = division.map((id) => squadStrength(byClub.get(id) ?? []));
  const expected = expectationFromStrength(squadStrength(byClub.get(userClubId) ?? []), strengths);

  await tx
    .update(careers)
    .set({
      expectedPosition: expected,
      // A new job or a new season starts from a clean slate rather than
      // inheriting the confidence that got the last manager sacked.
      boardConfidence: BOARD.startingConfidence,
      roundsInDanger: 0,
      underPressure: false,
    })
    .where(eq(careers.id, careerId));

  return expected;
}

/* ---------------------------------------------------------------- requests */

export type RequestResult = { ok: boolean; message: string };

/** Asks the board for money, and records the answer. */
export async function requestFunds(
  careerId: string,
  type: "transfer_funds" | "wage_room",
  askedEur: number,
): Promise<RequestResult> {
  const [career] = await db.select().from(careers).where(eq(careers.id, careerId)).limit(1);
  if (!career) return { ok: false, message: "No career" };

  const [finance] = await db
    .select()
    .from(careerClubFinance)
    .where(
      and(
        eq(careerClubFinance.careerId, careerId),
        eq(careerClubFinance.clubId, career.clubId),
      ),
    )
    .limit(1);

  if (!finance) return { ok: false, message: "This club has no accounts yet" };

  const previous = await db
    .select({ id: boardRequests.id })
    .from(boardRequests)
    .where(
      and(
        eq(boardRequests.careerId, careerId),
        eq(boardRequests.season, career.season),
        eq(boardRequests.type, type),
      ),
    );

  // What the club could plausibly find, which is what keeps the answer inside
  // the fiction of a budget rather than the board printing money on request.
  const headroom =
    type === "transfer_funds"
      ? Math.round(finance.transferBudget * 0.6 + 12_000_000)
      : Math.round(Math.max(0, finance.wageBudget) * 0.25 + 40_000);

  const verdict = evaluateFundsRequest(
    type,
    askedEur,
    career.boardConfidence,
    headroom,
    previous.length,
  );

  await db.transaction(async (tx) => {
    await tx.insert(boardRequests).values({
      careerId,
      season: career.season,
      round: career.currentRound,
      type,
      amountEur: askedEur,
      outcome: verdict.outcome,
      grantedEur: verdict.grantedEur,
      response: verdict.response,
    });

    if (verdict.grantedEur > 0) {
      await tx
        .update(careerClubFinance)
        .set(
          type === "transfer_funds"
            ? { transferBudget: sql`${careerClubFinance.transferBudget} + ${verdict.grantedEur}` }
            : { wageBudget: sql`${careerClubFinance.wageBudget} + ${verdict.grantedEur}` },
        )
        .where(
          and(
            eq(careerClubFinance.careerId, careerId),
            eq(careerClubFinance.clubId, career.clubId),
          ),
        );
    }
  });

  return { ok: verdict.outcome !== "refused", message: verdict.response };
}

/** Asks the board to list a player for sale. */
export async function requestSale(careerId: string, playerId: number): Promise<RequestResult> {
  const [career] = await db.select().from(careers).where(eq(careers.id, careerId)).limit(1);
  if (!career) return { ok: false, message: "No career" };

  const [row] = await db
    .select({ player: players, state: careerPlayerState })
    .from(players)
    .innerJoin(
      careerPlayerState,
      and(
        eq(careerPlayerState.playerId, players.id),
        eq(careerPlayerState.careerId, careerId),
      ),
    )
    .where(eq(players.id, playerId))
    .limit(1);

  if (!row) return { ok: false, message: "No such player" };
  if ((row.state.clubId ?? row.player.clubId) !== career.clubId) {
    return { ok: false, message: "He is not your player" };
  }

  // "Key" is measured against the squad he is in, so a good player at a great
  // club is not automatically untouchable.
  const squad = await db
    .select({ overall: players.overall })
    .from(players)
    .innerJoin(
      careerPlayerState,
      and(
        eq(careerPlayerState.playerId, players.id),
        eq(careerPlayerState.careerId, careerId),
      ),
    )
    .where(eq(sql`COALESCE(${careerPlayerState.clubId}, ${players.clubId})`, career.clubId));

  const ranked = squad.map((s) => s.overall).sort((a, b) => b - a);
  const isKeyPlayer = ranked.indexOf(row.player.overall) < 5;

  const verdict = evaluateSellRequest(row.player.shortName, isKeyPlayer, career.boardConfidence);

  await db.insert(boardRequests).values({
    careerId,
    season: career.season,
    round: career.currentRound,
    type: "sell_player",
    playerId,
    outcome: verdict.outcome,
    response: verdict.response,
  });

  return { ok: verdict.outcome === "granted", message: verdict.response };
}

/** This season's requests, newest first. */
export async function loadRequests(
  careerId: string,
  season: number,
): Promise<BoardRequestRow[]> {
  return db
    .select()
    .from(boardRequests)
    .where(and(eq(boardRequests.careerId, careerId), eq(boardRequests.season, season)))
    .orderBy(desc(boardRequests.id))
    .limit(20);
}

/* -------------------------------------------------------------- job offers */

/**
 * Clubs that would take a sacked manager on.
 *
 * Drawn from the weaker end of whatever he is qualified for: a manager just
 * dismissed by a top-six club does not walk into another one. Offers come from
 * clubs below his old one, which is what makes a sacking a real setback rather
 * than a sideways move.
 */
async function createJobOffers(
  tx: Tx,
  career: CareerRow,
  judgeSeason: number,
): Promise<void> {
  /*
   * `judgeSeason` is the season whose table says who is struggling, and it is
   * not always `career.season`. A relegation sacking happens after the rollover
   * has already moved the save on, so reading the current season there would
   * build a table of a competition nobody has played yet: every club level on
   * nothing, sorted alphabetically, and the "strugglers" coming out as whoever
   * is late in the alphabet. Which is how a manager who had just gone down was
   * offered the Manchester City job.
   */
  const finished = await tx
    .select({ clubId: seasonHistory.clubId, position: seasonHistory.position })
    .from(seasonHistory)
    .where(
      and(eq(seasonHistory.careerId, career.id), eq(seasonHistory.season, judgeSeason)),
    );

  const table =
    finished.length > 0
      ? finished.sort((a, b) => a.position - b.position)
      : (await buildLeagueTable(career.id, judgeSeason, tx)).map((row) => ({
          clubId: row.clubId,
          position: row.position,
        }));

  if (table.length === 0) return;

  // Clubs in the bottom half, excluding the one that just sacked him. A manager
  // out of work does not walk into a job at the top of the division.
  const candidates = table.filter(
    (row) => row.clubId !== career.clubId && row.position >= Math.floor(table.length / 2),
  );

  const clubRows = await tx
    .select({ id: clubs.id, name: clubs.name })
    .from(clubs)
    .where(inArray(clubs.id, candidates.map((c) => c.clubId)));
  const nameOf = new Map(clubRows.map((c) => [c.id, c.name]));

  // Three, so there is a choice to make without it being a menu.
  // The three best of the strugglers, so the choice is between real clubs
  // rather than the three worst sides in the country.
  const chosen = candidates.slice(0, 3);
  if (chosen.length === 0) return;

  await tx.insert(jobOffers).values(
    chosen.map((row) => ({
      careerId: career.id,
      clubId: row.clubId,
      season: career.season,
      expectedPosition: Math.max(1, row.position - 2),
      pitch: `${nameOf.get(row.clubId) ?? "They"} sit ${row.position}${
        row.position === 1 ? "st" : row.position === 2 ? "nd" : row.position === 3 ? "rd" : "th"
      } and want someone to steady them. They would settle for ${Math.max(1, row.position - 2)}th.`,
    })),
  );
}

/**
 * Relegation, which ends a job on its own.
 *
 * Kept separate from the confidence path because it is not a judgement: a board
 * that adored its manager still dismisses him when the club goes down, so this
 * bypasses the threshold and the run of bad rounds entirely.
 */
export async function sackForRelegation(careerId: string): Promise<void> {
  const [career] = await db.select().from(careers).where(eq(careers.id, careerId)).limit(1);
  if (!career) return;

  await db.transaction(async (tx) => {
    await tx
      .update(careers)
      .set({ phase: "sacked", underPressure: true, updatedAt: new Date() })
      .where(eq(careers.id, careerId));

    // The season just gone, not the one the rollover has already started.
    await createJobOffers(tx, career, career.season - 1);
  });
}

/** Open offers for a manager who is currently out of work. */
export async function loadJobOffers(careerId: string) {
  return db
    .select({
      id: jobOffers.id,
      clubId: jobOffers.clubId,
      clubName: clubs.name,
      primaryColor: clubs.primaryColor,
      expectedPosition: jobOffers.expectedPosition,
      pitch: jobOffers.pitch,
    })
    .from(jobOffers)
    .innerJoin(clubs, eq(clubs.id, jobOffers.clubId))
    .where(and(eq(jobOffers.careerId, careerId), eq(jobOffers.accepted, false)));
}

/**
 * Takes one of the jobs.
 *
 * The career continues with a new club: the save keeps its history and its
 * honours, because those belong to the manager rather than to the club, and
 * everything club-specific is re-derived for the new employer.
 */
export async function acceptJob(careerId: string, offerId: number): Promise<RequestResult> {
  const [offer] = await db
    .select()
    .from(jobOffers)
    .where(and(eq(jobOffers.id, offerId), eq(jobOffers.careerId, careerId)))
    .limit(1);

  if (!offer) return { ok: false, message: "That job is no longer available" };

  await db.transaction(async (tx) => {
    await tx.update(jobOffers).set({ accepted: true }).where(eq(jobOffers.id, offerId));
    await tx.delete(jobOffers).where(
      and(eq(jobOffers.careerId, careerId), eq(jobOffers.accepted, false)),
    );

    await tx
      .update(careers)
      .set({
        clubId: offer.clubId,
        phase: "idle",
        expectedPosition: offer.expectedPosition,
        boardConfidence: BOARD.startingConfidence,
        roundsInDanger: 0,
        underPressure: false,
        updatedAt: new Date(),
      })
      .where(eq(careers.id, careerId));
  });

  return { ok: true, message: "You have a job again." };
}
