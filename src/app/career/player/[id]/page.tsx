import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { careerPlayerState, clubs, players } from "@/db/schema";
import { requireCareer } from "@/lib/session";
import { averageRating, unavailableReason } from "@/lib/engineAdapter";
import {
  AttrRow,
  AvailabilityIcon,
  ClubDot,
  FitnessBar,
  FormBadge,
  Panel,
} from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

const CURRENCY = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "EUR",
  notation: "compact",
  maximumFractionDigits: 1,
});

export default async function PlayerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { career } = await requireCareer();
  const { id } = await params;
  const playerId = Number(id);

  if (!Number.isInteger(playerId)) notFound();

  const [row] = await db
    .select({ player: players, club: clubs, state: careerPlayerState })
    .from(players)
    .innerJoin(clubs, eq(clubs.id, players.clubId))
    .innerJoin(
      careerPlayerState,
      and(
        eq(careerPlayerState.playerId, players.id),
        eq(careerPlayerState.careerId, career.id),
      ),
    )
    .where(eq(players.id, playerId))
    .limit(1);

  if (!row) notFound();

  const { player, club, state } = row;
  const unavailable = unavailableReason(state, career.currentRound);
  const rating = averageRating(state);

  const technical = player.isGk
    ? [
        { label: "Diving", value: player.gkDiving },
        { label: "Handling", value: player.gkHandling },
        { label: "Kicking", value: player.gkKicking },
        { label: "Positioning", value: player.gkPositioning },
        { label: "Reflexes", value: player.gkReflexes },
        { label: "Rushing out", value: player.gkSpeed },
      ]
    : [
        { label: "Crossing", value: player.crossing },
        { label: "Finishing", value: player.finishing },
        { label: "Heading", value: player.headingAccuracy },
        { label: "Short passing", value: player.shortPassing },
        { label: "Long passing", value: player.longPassing },
        { label: "Dribbling", value: player.dribbling },
        { label: "Ball control", value: player.ballControl },
        { label: "Curve", value: player.curve },
        { label: "Free kicks", value: player.fkAccuracy },
        { label: "Volleys", value: player.volleys },
      ];

  const mental = [
    { label: "Composure", value: player.composure },
    { label: "Vision", value: player.vision },
    { label: "Positioning", value: player.positioning },
    { label: "Interceptions", value: player.interceptions },
    { label: "Aggression", value: player.aggression },
    { label: "Penalties", value: player.penalties },
    { label: "Reactions", value: player.reactions },
    ...(player.isGk
      ? []
      : [
          { label: "Marking", value: player.marking },
          { label: "Standing tackle", value: player.standingTackle },
          { label: "Sliding tackle", value: player.slidingTackle },
        ]),
  ];

  const physical = [
    { label: "Acceleration", value: player.acceleration },
    { label: "Sprint speed", value: player.sprintSpeed },
    { label: "Agility", value: player.agility },
    { label: "Balance", value: player.balance },
    { label: "Jumping", value: player.jumping },
    { label: "Stamina", value: player.stamina },
    { label: "Strength", value: player.strength },
    { label: "Shot power", value: player.shotPower },
    { label: "Long shots", value: player.longShots },
  ];

  const roundsOut =
    unavailable === "injured"
      ? (state.injuredUntilRound ?? 0) - career.currentRound + 1
      : unavailable === "suspended"
        ? (state.suspendedUntilRound ?? 0) - career.currentRound + 1
        : 0;

  return (
    <div className="space-y-3">
      <Link href="/career/squad" className="text-[11px] text-[var(--accent)] hover:underline">
        Back to squad
      </Link>

      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-4 p-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold">
              {player.shortName}
              <AvailabilityIcon reason={unavailable} />
            </h1>
            <p className="mt-0.5 text-[var(--text-muted)]">{player.longName}</p>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--text-muted)]">
              <span className="flex items-center gap-1.5">
                <ClubDot color={club.primaryColor} />
                {club.name}
              </span>
              <span>{player.positions.join(", ")}</span>
              <span>{player.age} years old</span>
              {player.nationality && <span>{player.nationality}</span>}
              {player.preferredFoot && <span>{player.preferredFoot} footed</span>}
              {player.heightCm && <span>{player.heightCm} cm</span>}
            </p>
            {unavailable && roundsOut > 0 && (
              <p className="mt-2 text-[var(--bad)]">
                {unavailable === "injured" ? "Injured" : "Suspended"} for the next {roundsOut}{" "}
                {roundsOut === 1 ? "match" : "matches"}
              </p>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
            <Stat label="Overall" value={String(player.overall)} />
            <Stat label="Potential" value={String(player.potential)} />
            <Stat
              label="Value"
              value={player.valueEur ? CURRENCY.format(player.valueEur) : "-"}
            />
            <Stat
              label="Wage"
              value={player.wageEur ? `${CURRENCY.format(player.wageEur)}/wk` : "-"}
            />
            <Stat label="Weak foot" value={`${player.weakFoot ?? "-"} / 5`} />
            <Stat label="Skill moves" value={`${player.skillMoves ?? "-"} / 5`} />
          </dl>
        </div>
      </Panel>

      <div className="grid gap-3 lg:grid-cols-4">
        <Panel title="This season">
          <dl className="space-y-2 p-3">
            <div className="flex items-center justify-between">
              <dt className="text-[var(--text-muted)]">Condition</dt>
              <dd>
                <FitnessBar value={state.fitness} />
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-[var(--text-muted)]">Form</dt>
              <dd>
                <FormBadge value={state.apps > 0 ? state.form : null} />
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-[var(--text-muted)]">Average rating</dt>
              <dd>
                <FormBadge value={rating} />
              </dd>
            </div>
            <hr className="border-[var(--border)]" />
            <SeasonStat label="Appearances" value={state.apps} />
            <SeasonStat label="Minutes" value={state.minutes} />
            <SeasonStat label="Goals" value={state.goals} />
            <SeasonStat label="Assists" value={state.assists} />
            <SeasonStat label="Yellow cards" value={state.yellows} />
            <SeasonStat label="Red cards" value={state.reds} />
          </dl>
        </Panel>

        <Panel title={player.isGk ? "Goalkeeping" : "Technical"}>
          <div className="p-3">
            {technical.map((a) => (
              <AttrRow key={a.label} label={a.label} value={a.value} />
            ))}
          </div>
        </Panel>

        <Panel title="Mental">
          <div className="p-3">
            {mental.map((a) => (
              <AttrRow key={a.label} label={a.label} value={a.value} />
            ))}
          </div>
        </Panel>

        <Panel title="Physical">
          <div className="p-3">
            {physical.map((a) => (
              <AttrRow key={a.label} label={a.label} value={a.value} />
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-[var(--text-dim)]">{label}</dt>
      <dd className="numeric font-semibold">{value}</dd>
    </div>
  );
}

function SeasonStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-[var(--text-muted)]">{label}</dt>
      <dd className="numeric font-medium">{value}</dd>
    </div>
  );
}
