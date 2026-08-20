import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { finishMatchday } from "@/lib/matchService";
import { getCareerId } from "@/lib/session";

/** Ends the round: settles the match, plays the other nine, moves the week on. */
export async function POST() {
  const careerId = await getCareerId();
  if (!careerId) {
    return NextResponse.json({ error: "No career in this browser" }, { status: 401 });
  }

  try {
    const result = await finishMatchday(careerId);
    // Settling a round changes the header's fixture, every squad's fitness, the
    // table and the budgets. Without this the manager had to reload before the
    // next match could be started, because the client kept serving the cached
    // layout from before the round was played.
    revalidatePath("/career", "layout");
    return NextResponse.json(result);
  } catch (error) {
    console.error("POST /api/match/finish failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not finish the round" },
      { status: 400 },
    );
  }
}
