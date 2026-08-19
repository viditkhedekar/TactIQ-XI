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
import { createOrResumeCareer, saveTactics, validateLineup } from "@/lib/careerService";
import { clearCareerCookie, requireCareer, setCareerCookie } from "@/lib/session";
import { createCareerSchema, firstError, tacticsSchema } from "@/lib/validation";
import type { Slot } from "@/engine";

export type ActionState = { error?: string } | null;

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

  const problems = await validateLineup(
    career.id,
    career.clubId,
    career.currentRound,
    parsed.data.lineup as { playerId: number; slot: Slot }[],
    parsed.data.bench,
  );
  if (problems.length > 0) return { error: problems[0] };

  await saveTactics(career.id, {
    ...parsed.data,
    lineup: parsed.data.lineup as { playerId: number; slot: Slot }[],
  });

  revalidatePath("/career/tactics");
  revalidatePath("/career/squad");
  return null;
}
