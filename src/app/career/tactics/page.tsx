import { requireCareer } from "@/lib/session";
import { loadSquad, loadTactics } from "@/lib/careerService";
import { unavailableReason } from "@/lib/engineAdapter";
import { positionFit, type Slot } from "@/engine";
import { toEnginePlayer } from "@/lib/engineAdapter";
import { TacticsBoard, type TacticsPlayer } from "@/components/tactics/TacticsBoard";
import type { FormationName } from "@/engine";

export const dynamic = "force-dynamic";

export default async function TacticsPage() {
  const { career } = await requireCareer();
  const [squad, tactics] = await Promise.all([
    loadSquad(career.id, career.clubId),
    loadTactics(career.id),
  ]);

  // Position fit is computed here rather than in the browser so the tactics
  // board can show it without shipping the whole rating model to the client.
  const players: TacticsPlayer[] = squad.map(({ player, state }) => {
    const engine = toEnginePlayer(player, state);
    const fits: Partial<Record<Slot, number>> = {};
    const slots: Slot[] = [
      "GK", "LB", "LCB", "CB", "RCB", "RB", "LWB", "RWB", "CDM", "LCM", "CM",
      "RCM", "CAM", "LM", "RM", "LW", "RW", "ST", "LST", "RST",
    ];
    for (const slot of slots) fits[slot] = positionFit(engine, slot);

    return {
      id: player.id,
      name: player.shortName,
      positions: player.positions.join(", "),
      isGk: player.isGk,
      overall: player.overall,
      fitness: state.fitness,
      form: state.apps > 0 ? state.form : null,
      unavailable: unavailableReason(state, career.currentRound),
      fits: fits as Record<Slot, number>,
    };
  });

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Tactics</h1>

      <TacticsBoard
        players={players}
        initial={{
          formation: (tactics?.formation ?? "4-3-3") as FormationName,
          mentality: tactics?.mentality ?? 3,
          pressing: tactics?.pressing ?? 3,
          tempo: tactics?.tempo ?? 3,
          width: tactics?.width ?? 3,
          directness: tactics?.directness ?? 3,
          lineup: (tactics?.lineup as { playerId: number; slot: Slot }[]) ?? [],
          bench: (tactics?.bench as number[]) ?? [],
        }}
      />
    </div>
  );
}
