import { NextResponse } from "next/server";
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
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not simulate the round" },
      { status: 400 },
    );
  }
}
