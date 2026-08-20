import { requireCareer } from "@/lib/session";
import { loadSquad, loadTactics } from "@/lib/careerService";
import { toEnginePlayer, toBench, toLineup, toTeamTactics, unavailableReason } from "@/lib/engineAdapter";
import {
  DEFAULT_TACTICS,
  placementsFromFormation,
  positionFit,
  selectLineup,
  type PitchPlacement,
  type Slot,
} from "@/engine";
import { TacticsBoard, type TacticsPlayer } from "@/components/tactics/TacticsBoard";

export const dynamic = "force-dynamic";

const ALL_SLOTS: Slot[] = [
  "GK", "LB", "LCB", "CB", "RCB", "RB", "LWB", "RWB", "CDM", "LCM", "CM",
  "RCM", "CAM", "LM", "RM", "LW", "RW", "ST", "LST", "RST",
];

export default async function TacticsPage() {
  const { career } = await requireCareer();
  const [squad, tacticsRow] = await Promise.all([
    loadSquad(career.id, career.clubId),
    loadTactics(career.id),
  ]);

  // Position fit is computed here rather than in the browser so the board can
  // colour every marker without shipping the whole rating model to the client.
  const players: TacticsPlayer[] = squad.map(({ player, state }) => {
    const engine = toEnginePlayer(player, state);
    const fits = {} as Record<Slot, number>;
    for (const slot of ALL_SLOTS) fits[slot] = positionFit(engine, slot);

    return {
      id: player.id,
      name: player.shortName,
      positions: player.positions.join(", "),
      isGk: player.isGk,
      overall: player.overall,
      fitness: state.fitness,
      form: state.apps > 0 ? state.form : null,
      unavailable: unavailableReason(state, career.currentRound),
      fits,
    };
  });

  const stored = tacticsRow ? toTeamTactics(tacticsRow) : DEFAULT_TACTICS;

  /**
   * A saved team sheet can name players who are no longer here.
   *
   * Selling someone does not rewrite every plan that mentioned him, so his id
   * lingers in the lineup, on the bench, on the penalties, or on the armband.
   * The board would then refuse to save with "that player is not in your squad"
   * while showing nothing the manager could actually remove, because a departed
   * player is not in the list either. Cleaning up on load is the fix: the sheet
   * quietly loses whoever has gone, and the gap is filled below.
   */
  const squadIds = new Set(squad.map((m) => m.player.id));
  const ours = (id: number | null) => (id !== null && squadIds.has(id) ? id : null);

  const tactics = {
    ...stored,
    captainId: ours(stored.captainId),
    setPieces: {
      corners: ours(stored.setPieces.corners),
      freeKicks: ours(stored.setPieces.freeKicks),
      penalties: ours(stored.setPieces.penalties),
      throwIns: ours(stored.setPieces.throwIns),
      cornerDelivery: stored.setPieces.cornerDelivery,
    },
  };

  let lineup: PitchPlacement[] = (tacticsRow ? toLineup(tacticsRow) : []).filter((e) =>
    squadIds.has(e.playerId),
  );
  let bench = (tacticsRow ? toBench(tacticsRow) : []).filter((id) => squadIds.has(id));

  // A career with no usable team sheet still has to open onto eleven players
  // standing somewhere, or there is nothing to drag.
  if (lineup.length < 11) {
    const engine = squad.map(({ player, state }) => toEnginePlayer(player, state));
    const picked = selectLineup(engine, tactics.formation);
    lineup = placementsFromFormation(picked.lineup);
    if (bench.length === 0) bench = picked.benchIds;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">Tactics</h1>
        <p className="text-[11px] text-[var(--text-dim)]">
          No formations to pick from. Arrange the eleven and the shape is whatever you have built.
        </p>
      </div>

      <TacticsBoard
        players={players}
        initialTactics={tactics}
        initialLineup={lineup}
        initialBench={bench}
      />
    </div>
  );
}
