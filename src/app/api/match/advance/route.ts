import { NextResponse } from "next/server";
import { advanceMatch } from "@/lib/matchService";
import { getCareerId } from "@/lib/session";

/** Simulates the next stretch of the live match. */
export async function POST() {
  const careerId = await getCareerId();
  if (!careerId) {
    return NextResponse.json({ error: "No career in this browser" }, { status: 401 });
  }

  try {
    return NextResponse.json(await advanceMatch(careerId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not advance the match" },
      { status: 400 },
    );
  }
}
