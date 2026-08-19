/**
 * Which career the current browser is playing.
 *
 * There is no real authentication: a career is identified by a cookie holding
 * its id, set when the manager enters a username. That is a deliberate choice
 * for a hobby game among friends, and it means anyone who learns a username
 * can resume that career. It is not a security boundary and should not be
 * treated as one if this ever holds anything worth protecting.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loadCareer, type CareerContext } from "./careerService";

export const CAREER_COOKIE = "career_id";

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
  secure: process.env.NODE_ENV === "production",
};

export async function setCareerCookie(careerId: string): Promise<void> {
  const store = await cookies();
  store.set(CAREER_COOKIE, careerId, COOKIE_OPTIONS);
}

export async function clearCareerCookie(): Promise<void> {
  const store = await cookies();
  store.delete(CAREER_COOKIE);
}

export async function getCareerId(): Promise<string | null> {
  const store = await cookies();
  return store.get(CAREER_COOKIE)?.value ?? null;
}

/** The current career, or null if there is no valid one. */
export async function getCareer(): Promise<CareerContext | null> {
  const careerId = await getCareerId();
  if (!careerId) return null;
  return loadCareer(careerId);
}

/**
 * The current career, or a redirect to the landing page. Used by every screen
 * inside a career, so a stale cookie sends the manager back to sign in rather
 * than throwing.
 */
export async function requireCareer(): Promise<CareerContext> {
  const career = await getCareer();
  if (!career) redirect("/");
  return career;
}
