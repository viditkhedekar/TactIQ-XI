/**
 * The squad list: the screen a manager spends most of their time on.
 *
 * Dense on purpose. Every row carries the player's key attributes, their
 * condition, and what they have contributed this season, so team selection can
 * be reasoned about without opening anyone's profile.
 */

import { requireCareer } from "@/lib/session";
import { loadSquad } from "@/lib/careerService";
import { averageRating, unavailableReason } from "@/lib/engineAdapter";
import { SquadTable, type SquadRow } from "@/components/squad/SquadTable";

export const dynamic = "force-dynamic";

export default async function SquadPage() {
  const { career, club } = await requireCareer();
  const squad = await loadSquad(career.id, career.clubId);

  const rows: SquadRow[] = squad.map(({ player, state }) => ({
    id: player.id,
    name: player.shortName,
    positions: player.positions.join(", "),
    isGk: player.isGk,
    age: player.age,
    overall: player.overall,
    nationality: player.nationality,
    jersey: player.jersey,
    fitness: state.fitness,
    form: state.form,
    unavailable: unavailableReason(state, career.currentRound),
    injuredUntilRound: state.injuredUntilRound,
    suspendedUntilRound: state.suspendedUntilRound,
    listedForSale: state.listedForSale,
    apps: state.apps,
    goals: state.goals,
    assists: state.assists,
    avgRating: averageRating(state),
    // The handful of attributes worth seeing for every player at a glance.
    pace: Math.round((player.acceleration + player.sprintSpeed) / 2),
    passing: player.shortPassing,
    shooting: player.isGk ? player.gkReflexes : player.finishing,
    defending: player.isGk ? player.gkHandling : player.standingTackle,
    physical: player.strength,
    stamina: player.stamina,
  }));

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">{club.name} squad</h1>
        <p className="text-[var(--text-muted)]">
          {rows.length} players
          <span className="mx-1.5 text-[var(--text-dim)]">·</span>
          {rows.filter((r) => r.unavailable).length} unavailable
        </p>
      </div>

      <SquadTable rows={rows} currentRound={career.currentRound} />
    </div>
  );
}
