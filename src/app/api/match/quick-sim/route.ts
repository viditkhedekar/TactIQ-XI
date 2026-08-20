import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { quickSimMatchday } from "@/lib/matchService";
import { getCareerId } from "@/lib/session";

/** Plays the manager's fixture and the rest of the round without the ticker. */
export async function POST() {
  const careerId = await getCareerId();
  if (!careerId) {
    return NextResponse.json({ error: "No career in this browser" }, { status: 401 });
  }

  try {
    const result = await quickSimMatchday(careerId);
    // See the finish route: the whole career subtree is stale once a round has
    // been played, not just the page the button was on.
    revalidatePath("/career", "layout");
    return NextResponse.json(result);
  } catch (error) {
    console.error("POST /api/match/quick-sim failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not simulate the round" },
      { status: 400 },
    );
  }
}
