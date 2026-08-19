import { NextResponse } from "next/server";
import { finishMatchday } from "@/lib/matchService";
import { getCareerId } from "@/lib/session";

/** Ends the round: settles the match, plays the other nine, moves the week on. */
export async function POST() {
  const careerId = await getCareerId();
  if (!careerId) {
    return NextResponse.json({ error: "No career in this browser" }, { status: 401 });
  }

  try {
    return NextResponse.json(await finishMatchday(careerId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not finish the round" },
      { status: 400 },
    );
  }
}
