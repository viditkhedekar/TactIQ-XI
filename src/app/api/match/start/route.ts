import { NextResponse } from "next/server";
import { loadMatchEvents, startMatchday } from "@/lib/matchService";
import { getCareerId } from "@/lib/session";
import { placementsFromFormation, type MatchSide } from "@/engine";

/**
 * Opens the manager's fixture and returns what the ticker needs to render.
 *
 * Only the lineups and instructions cross the wire, not the full engine state:
 * the browser has no business knowing the opposition's fitness levels, and the
 * state object is large enough that sending it every time would be wasteful.
 */
function summarise(side: MatchSide) {
  return {
    clubId: side.clubId,
    clubName: side.clubName,
    isUser: side.isUser,
    tactics: side.tactics,
    // Where the eleven are standing, derived from their slots. The live match
    // state carries roles rather than coordinates, so the drawer's board is
    // laid out from the anchor each role rests at.
    placements: placementsFromFormation(
      side.onPitch.map((lp) => ({ playerId: lp.player.id, slot: lp.slot })),
    ),
    onPitch: side.onPitch.map((lp) => ({
      id: lp.player.id,
      name: lp.player.name,
      slot: lp.slot,
      isGk: lp.player.isGk,
      fitness: Math.round(lp.fitness),
    })),
    bench: side.bench.map((lp) => ({
      id: lp.player.id,
      name: lp.player.name,
      isGk: lp.player.isGk,
      fitness: Math.round(lp.fitness),
    })),
  };
}

export async function POST() {
  const careerId = await getCareerId();
  if (!careerId) {
    return NextResponse.json({ error: "No career in this browser" }, { status: 401 });
  }

  try {
    const { fixture, state } = await startMatchday(careerId);

    // A match already under way is rejoined rather than restarted, so the
    // commentary recorded so far comes back with it. Without this, refreshing
    // the page mid-match leaves the manager staring at an empty ticker.
    const events = state.minute > 0 ? await loadMatchEvents(fixture.id) : [];

    return NextResponse.json({
      fixtureId: fixture.id,
      round: fixture.round,
      minute: state.minute,
      homeGoals: state.homeGoals,
      awayGoals: state.awayGoals,
      finished: state.finished,
      events,
      home: summarise(state.home),
      away: summarise(state.away),
    });
  } catch (error) {
    console.error("POST /api/match/start failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not start the match" },
      { status: 400 },
    );
  }
}
