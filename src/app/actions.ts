"use server";

/**
 * Server actions for the forms in the interface.
 *
 * Each one validates its input before touching the database and returns a
 * message rather than throwing, so the page can show the manager what went
 * wrong without losing what they typed.
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createOrResumeCareer, loadSquad, saveTactics, validateLineup } from "@/lib/careerService";
import { clearCareerCookie, requireCareer, setCareerCookie } from "@/lib/session";
import {
  createCareerSchema,
  firstError,
  offerSchema,
  tacticsSchema,
  trainingPlanSchema,
} from "@/lib/validation";
import {
  loadTrainingPlan,
  saveTrainingPlan,
  setIndividualFocus,
} from "@/lib/trainingService";
import {
  acceptCounter,
  makeOffer,
  respondToIncoming,
  withdrawOffer,
} from "@/lib/transferService";
import { db } from "@/db/client";
import {
  acceptJob,
  requestFunds,
  requestSale,
  sackForRelegation,
  setExpectation,
} from "@/lib/boardService";
import { regenerateSeasonFixtures, rolloverSeason } from "@/lib/seasonService";
import {
  isTrainingFocus,
  normaliseTactics,
  type PitchPlacement,
  type TeamTactics,
  type TrainingFocus,
  type TrainingIntensity,
} from "@/engine";

export type ActionState = { error?: string } | null;

/**
 * Marks every career screen stale.
 *
 * Anything that moves the game on changes more than the page it happened on: a
 * completed transfer changes the budget, both squads, and the header. Listing
 * individual paths meant the layout was never revalidated at all, which is why
 * the header kept showing the round that had just been played. Revalidating the
 * whole subtree is both correct and impossible to under-specify by forgetting a
 * path.
 */
function revalidateCareer(): void {
  revalidatePath("/career", "layout");
}

/** Starts a new career, or resumes the one belonging to this username. */
export async function startCareerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const rawClubId = formData.get("clubId");

  const parsed = createCareerSchema.safeParse({
    username: String(formData.get("username") ?? ""),
    clubId: rawClubId ? Number(rawClubId) : undefined,
  });

  if (!parsed.success) return { error: firstError(parsed.error) };

  let careerId: string;
  try {
    const { career } = await createOrResumeCareer(parsed.data.username, parsed.data.clubId);
    careerId = career.id;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not start that career",
    };
  }

  await setCareerCookie(careerId);
  redirect("/career/squad");
}

export async function signOutAction(): Promise<void> {
  await clearCareerCookie();
  redirect("/");
}

/** Saves the manager's shape, instructions and team sheet. */
export async function saveTacticsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { career } = await requireCareer();

  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get("payload") ?? "{}"));
  } catch {
    return { error: "That team sheet could not be read" };
  }

  const parsed = tacticsSchema.safeParse(payload);
  if (!parsed.success) return { error: firstError(parsed.error) };

  const lineup = parsed.data.lineup as PitchPlacement[];

  const problems = await validateLineup(
    career.id,
    career.clubId,
    career.currentRound,
    lineup,
    parsed.data.bench,
  );
  // All of them, not just the first. A manager with two unavailable players
  // should not have to save twice to find that out.
  if (problems.length > 0) return { error: problems.join(". ") };

  // The captain has to be someone the manager actually has, and the same goes
  // for every set piece taker, or a crafted payload could hand the armband to
  // an opposition player.
  const squadIds = new Set((await loadSquad(career.id, career.clubId)).map((m) => m.player.id));
  const ours = (id: number | null) => (id !== null && squadIds.has(id) ? id : null);

  await saveTactics(
    career.id,
    normaliseTactics({
      ...parsed.data,
      formation: parsed.data.formation as TeamTactics["formation"],
      captainId: ours(parsed.data.captainId),
      setPieces: {
        corners: ours(parsed.data.setPieces.corners),
        freeKicks: ours(parsed.data.setPieces.freeKicks),
        penalties: ours(parsed.data.setPieces.penalties),
        throwIns: ours(parsed.data.setPieces.throwIns),
        cornerDelivery: parsed.data.setPieces.cornerDelivery,
      },
    }),
    lineup,
    parsed.data.bench,
  );

  revalidateCareer();
  return null;
}

/* ----------------------------------------------------------------- training */

/**
 * Sets the squad's training focus, keeping the intensity where it is.
 *
 * Called both from the training screen and from the post-match report, which is
 * why it takes a bare focus rather than a form: the report's whole value is
 * that acting on it costs one click.
 */
export async function setTrainingFocusAction(focus: string): Promise<ActionState> {
  const { career } = await requireCareer();

  if (!isTrainingFocus(focus)) return { error: "That is not a training focus" };

  const current = await loadTrainingPlan(career.id);
  await saveTrainingPlan(career.id, focus, current.intensity);

  revalidateCareer();
  return null;
}

export async function saveTrainingAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { career } = await requireCareer();

  const parsed = trainingPlanSchema.safeParse({
    focus: String(formData.get("focus") ?? ""),
    intensity: Number(formData.get("intensity") ?? 3),
  });
  if (!parsed.success) return { error: firstError(parsed.error) };

  await saveTrainingPlan(
    career.id,
    parsed.data.focus as TrainingFocus,
    parsed.data.intensity as TrainingIntensity,
  );

  revalidateCareer();
  return null;
}

/** Puts one player on his own programme, or takes him off it. */
export async function setIndividualFocusAction(
  playerId: number,
  focus: string | null,
): Promise<ActionState> {
  const { career } = await requireCareer();

  if (!Number.isInteger(playerId)) return { error: "That is not a player" };
  if (focus !== null && !isTrainingFocus(focus)) {
    return { error: "That is not a training focus" };
  }

  // Only the manager's own players, so a crafted request cannot put somebody
  // else's striker on extra finishing work.
  const squad = await loadSquad(career.id, career.clubId);
  if (!squad.some((m) => m.player.id === playerId)) {
    return { error: "He is not in your squad" };
  }

  await setIndividualFocus(career.id, playerId, focus);
  revalidateCareer();
  return null;
}

/* ---------------------------------------------------------------- transfers */

export type OfferState = { error?: string; message?: string } | null;

export async function makeOfferAction(
  _prev: OfferState,
  formData: FormData,
): Promise<OfferState> {
  const { career } = await requireCareer();

  const parsed = offerSchema.safeParse({
    playerId: Number(formData.get("playerId") ?? 0),
    feeEur: Number(formData.get("feeEur") ?? 0),
    wageEur: Number(formData.get("wageEur") ?? 0),
  });
  if (!parsed.success) return { error: firstError(parsed.error) };

  const result = await makeOffer(
    career.id,
    career.clubId,
    career.currentRound,
    parsed.data.playerId,
    parsed.data.feeEur,
    parsed.data.wageEur,
  );

  revalidateCareer();
  if (!result.ok) return { error: result.error };
  return { message: "Bid submitted. They will respond next round." };
}

export async function withdrawOfferAction(offerId: string): Promise<OfferState> {
  const { career } = await requireCareer();
  await withdrawOffer(career.id, offerId);
  revalidateCareer();
  return { message: "Bid withdrawn" };
}

export async function acceptCounterAction(offerId: string): Promise<OfferState> {
  const { career } = await requireCareer();
  const result = await acceptCounter(career.id, offerId, career.currentRound);
  revalidateCareer();
  return result.ok ? { message: result.message } : { error: result.message };
}

export async function respondToOfferAction(
  offerId: string,
  accept: boolean,
): Promise<OfferState> {
  const { career } = await requireCareer();
  const result = await respondToIncoming(career.id, offerId, accept, career.currentRound);
  revalidateCareer();
  return result.ok ? { message: result.message } : { error: result.message };
}

/* -------------------------------------------------------------------- board */

/** Asks the board to release money. */
export async function requestFundsAction(
  _prev: OfferState,
  formData: FormData,
): Promise<OfferState> {
  const { career } = await requireCareer();

  const type = String(formData.get("type") ?? "");
  if (type !== "transfer_funds" && type !== "wage_room") {
    return { error: "That is not something you can ask for" };
  }

  const amount = Number(formData.get("amountEur") ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Ask for a real figure" };
  }

  const result = await requestFunds(career.id, type, Math.round(amount));
  revalidateCareer();
  return result.ok ? { message: result.message } : { error: result.message };
}

/** Asks the board to make a player available for transfer. */
export async function requestSaleAction(playerId: number): Promise<OfferState> {
  const { career } = await requireCareer();

  if (!Number.isInteger(playerId)) return { error: "That is not a player" };

  const result = await requestSale(career.id, playerId);
  revalidateCareer();
  return result.ok ? { message: result.message } : { error: result.message };
}

/* ------------------------------------------------------------------ season */

/** Closes the finished season and opens the next one. */
export async function startNextSeasonAction(): Promise<ActionState> {
  const { career } = await requireCareer();

  if (career.phase !== "season_over") {
    return { error: "The season is still going" };
  }

  const result = await rolloverSeason(career.id);

  // Relegation costs the manager his job, whatever the board thought of him
  // until that point. The offers are written here so the sacked screen has
  // something to show.
  if (result.userRelegated) {
    await sackForRelegation(career.id);
  } else {
    await db.transaction(async (tx) => {
      await setExpectation(tx, career.id, career.season + 1, career.clubId);
    });
    await regenerateSeasonFixtures(career.id, career.season + 1);
  }

  revalidateCareer();
  redirect(result.userRelegated ? "/career/board" : "/career/fixtures");
}

/** Takes one of the jobs offered after a sacking. */
export async function acceptJobAction(offerId: number): Promise<ActionState> {
  const { career } = await requireCareer();

  const result = await acceptJob(career.id, offerId);
  if (!result.ok) return { error: result.message };

  revalidateCareer();
  redirect("/career/squad");
}
