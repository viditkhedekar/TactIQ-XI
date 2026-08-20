/**
 * The training screen.
 *
 * Two decisions live here: what the squad works on, and how hard. Everything
 * else is feedback, because training is slow and invisible by nature and a
 * manager who cannot see it working will assume it is not. The report of last
 * week's movement is the answer to that.
 */

import Link from "next/link";
import { requireCareer } from "@/lib/session";
import { loadSquad } from "@/lib/careerService";
import {
  loadIndividualFocuses,
  loadLatestTrainingReport,
  loadTrainingPlan,
} from "@/lib/trainingService";
import { Attr, EmptyState, FitnessBar, Panel } from "@/components/ui/primitives";
import { TrainingPlanForm } from "@/components/training/TrainingPlanForm";
import { IndividualFocusPicker } from "@/components/training/IndividualFocusPicker";
import { TRAINING, TRAINING_FOCUS_LABELS, type TrainingFocus } from "@/engine";

export const dynamic = "force-dynamic";

type Improvement = {
  playerId: number;
  name: string;
  attribute: string;
  from: number;
  to: number;
};

type TrainingInjury = { playerId: number; name: string; outRounds: number };

/** Turns an attribute key into something readable in a sentence. */
function attributeLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^gk /i, "")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

export default async function TrainingPage() {
  const { career, club } = await requireCareer();

  const [plan, squad, report] = await Promise.all([
    loadTrainingPlan(career.id),
    loadSquad(career.id, career.clubId),
    loadLatestTrainingReport(career.id),
  ]);

  const focuses = await loadIndividualFocuses(
    career.id,
    squad.map((m) => m.player.id),
  );

  const improvements = (report?.improvements ?? []) as Improvement[];
  const injuries = (report?.injuries ?? []) as TrainingInjury[];

  // Grouped so the list reads as "these three players got better" rather than
  // as a wall of individual attribute rows.
  const byPlayer = new Map<number, { name: string; changes: Improvement[] }>();
  for (const item of improvements) {
    const entry = byPlayer.get(item.playerId) ?? { name: item.name, changes: [] };
    entry.changes.push(item);
    byPlayer.set(item.playerId, entry);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">Training</h1>
        <p className="text-[11px] text-[var(--text-dim)]">
          Applied every week, between rounds. Progress is slow by design.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel title="This week's plan">
          <TrainingPlanForm initialFocus={plan.focus} initialIntensity={plan.intensity} />
        </Panel>

        <div className="space-y-3">
          <Panel
            title="Last week"
            action={
              report ? (
                <span className="text-[11px] text-[var(--text-dim)]">
                  {TRAINING_FOCUS_LABELS[report.focus as TrainingFocus] ?? report.focus}, round{" "}
                  {report.round}
                </span>
              ) : null
            }
          >
            {!report ? (
              <EmptyState>Nothing yet. Play a round and training will run.</EmptyState>
            ) : byPlayer.size === 0 ? (
              <p className="px-3 py-4 text-[11px] text-[var(--text-muted)]">
                No attribute moved a full point this week. The work still counts: gains
                accumulate in fractions and show up once they cross a point.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {[...byPlayer.entries()].map(([playerId, entry]) => (
                  <li key={playerId} className="px-3 py-2">
                    <Link
                      href={`/career/player/${playerId}`}
                      className="font-medium hover:text-[var(--accent)]"
                    >
                      {entry.name}
                    </Link>
                    <ul className="mt-0.5 space-y-0.5">
                      {entry.changes.map((change) => (
                        <li
                          key={change.attribute}
                          className="flex items-center justify-between text-[11px]"
                        >
                          <span className="text-[var(--text-muted)]">
                            {attributeLabel(change.attribute)}
                          </span>
                          <span className="numeric flex items-center gap-1">
                            <span className="text-[var(--text-dim)]">{change.from}</span>
                            <span
                              className="text-[var(--text-dim)]"
                              aria-label={change.to > change.from ? "rose to" : "fell to"}
                            >
                              {change.to > change.from ? "↑" : "↓"}
                            </span>
                            <span
                              style={{
                                color:
                                  change.to > change.from ? "var(--good)" : "var(--bad)",
                              }}
                            >
                              {change.to}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {injuries.length > 0 && (
            <Panel title="Hurt in training">
              <ul className="divide-y divide-[var(--border)]">
                {injuries.map((injury) => (
                  <li
                    key={injury.playerId}
                    className="flex items-center justify-between px-3 py-1.5"
                  >
                    <span>{injury.name}</span>
                    <span className="text-[11px] text-[var(--bad)]">
                      out {injury.outRounds} {injury.outRounds === 1 ? "round" : "rounds"}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>

      <Panel
        title={`${club.name} squad`}
        action={
          <span className="text-[11px] text-[var(--text-dim)]">
            Individual work overrides the squad plan for that player
          </span>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[var(--border)] text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
                <th className="px-3 py-1.5 font-medium">Player</th>
                <th className="px-1 py-1.5 font-medium">Pos</th>
                <th className="px-1 py-1.5 text-right font-medium">Age</th>
                <th className="px-1 py-1.5 text-right font-medium">Ovr</th>
                <th className="px-1 py-1.5 text-right font-medium">Pot</th>
                <th className="px-2 py-1.5 font-medium">Condition</th>
                <th className="w-40 px-3 py-1.5 font-medium">Working on</th>
              </tr>
            </thead>
            <tbody>
              {squad.map(({ player, state }) => {
                // Room to grow is the single most useful thing on this screen:
                // it decides whether training this player is worth the week.
                const room = player.potential - player.overall;
                const ageBand = TRAINING.ageGrowth.find((b) => player.age <= b.maxAge);
                const prospect = room >= 4 && player.age <= 24;

                return (
                  <tr
                    key={player.id}
                    className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-hover)]"
                  >
                    <td className="px-3 py-1">
                      <Link
                        href={`/career/player/${player.id}`}
                        className="hover:text-[var(--accent)]"
                      >
                        {player.shortName}
                      </Link>
                      {prospect && (
                        <span
                          className="ml-1.5 rounded px-1 text-[9px] font-bold text-[var(--elite)]"
                          style={{ background: "color-mix(in srgb, currentColor 14%, transparent)" }}
                          title="Young, with room to improve"
                        >
                          PROSPECT
                        </span>
                      )}
                    </td>
                    <td className="px-1 py-1 text-[10px] text-[var(--text-dim)]">
                      {player.positions[0]}
                    </td>
                    <td className="numeric px-1 py-1 text-right text-[11px] text-[var(--text-muted)]">
                      {player.age}
                    </td>
                    <td className="px-1 py-1 text-right">
                      <Attr value={player.overall} />
                    </td>
                    <td className="px-1 py-1 text-right">
                      <span
                        className="numeric text-[11px]"
                        style={{
                          color: room > 0 ? "var(--good)" : "var(--text-dim)",
                        }}
                        title={
                          ageBand
                            ? `Improves at ${Math.round(ageBand.factor * 100)} percent of full rate at this age`
                            : undefined
                        }
                      >
                        {player.potential}
                      </span>
                    </td>
                    <td className="px-2 py-1">
                      <FitnessBar value={state.fitness} />
                    </td>
                    <td className="px-3 py-1">
                      <IndividualFocusPicker
                        playerId={player.id}
                        current={focuses.get(player.id) ?? null}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
