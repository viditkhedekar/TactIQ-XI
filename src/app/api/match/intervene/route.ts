import { NextResponse } from "next/server";
import { interveneInMatch } from "@/lib/matchService";
import { getCareerId } from "@/lib/session";
import { firstError, interventionSchema } from "@/lib/validation";
import type { PitchPlacement, TeamTactics } from "@/engine";

/** Applies the manager's substitutions and instructions at a pause point. */
export async function POST(request: Request) {
  const careerId = await getCareerId();
  if (!careerId) {
    return NextResponse.json({ error: "No career in this browser" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "That request could not be read" }, { status: 400 });
  }

  const parsed = interventionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: firstError(parsed.error) }, { status: 400 });
  }

  try {
    const result = await interveneInMatch(careerId, parsed.data.atMinute, {
      tactics: parsed.data.tactics as Partial<TeamTactics> | undefined,
      subs: parsed.data.subs,
      placements: parsed.data.placements as PitchPlacement[] | undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not apply those changes" },
      { status: 400 },
    );
  }
}
