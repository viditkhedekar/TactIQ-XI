import { NextResponse } from "next/server";
import { z } from "zod";
import { advanceMatch } from "@/lib/matchService";
import { getCareerId } from "@/lib/session";

const bodySchema = z.object({
  /** How far the browser's ticker has actually revealed. */
  revealedMinute: z.number().int().min(0).max(120).optional(),
});

/** Simulates the next stretch of the live match. */
export async function POST(request: Request) {
  const careerId = await getCareerId();
  if (!careerId) {
    return NextResponse.json({ error: "No career in this browser" }, { status: 401 });
  }

  // The body is optional: a request without one simply cannot move the rewind
  // point forward, which is the safe default.
  let revealedMinute: number | undefined;
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (parsed.success) revealedMinute = parsed.data.revealedMinute;
  } catch {
    revealedMinute = undefined;
  }

  try {
    return NextResponse.json(await advanceMatch(careerId, revealedMinute ?? 0));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not advance the match" },
      { status: 400 },
    );
  }
}
