/**
 * Player development over the life of a save.
 *
 * The graph is the point of the screen, but it is useless in season one when
 * every line is a single dot, so the page leads with the table of movement and
 * only shows the chart once there is something to plot.
 */

import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { playerDevelopment } from "@/db/schema";
import { requireCareer } from "@/lib/session";
import { loadSquad } from "@/lib/careerService";
import { toEnginePlayer } from "@/lib/engineAdapter";
import { Attr, EmptyState, Panel } from "@/components/ui/primitives";
import {
  DevelopmentChart,
  type DevelopmentSeries,
} from "@/components/development/DevelopmentChart";

export const dynamic = "force-dynamic";

export default async function DevelopmentPage() {
  const { career } = await requireCareer();

  const squad = await loadSquad(career.id, career.clubId);
  const playerIds = squad.map((m) => m.player.id);

  const snapshots =
    playerIds.length > 0
      ? await db
          .select()
          .from(playerDevelopment)
          .where(
            and(
              eq(playerDevelopment.careerId, career.id),
              inArray(playerDevelopment.playerId, playerIds),
            ),
          )
          .orderBy(asc(playerDevelopment.season))
      : [];

  const byPlayer = new Map<number, typeof snapshots>();
  for (const row of snapshots) {
    const list = byPlayer.get(row.playerId) ?? [];
    list.push(row);
    byPlayer.set(row.playerId, list);
  }

  // A line per player: every season already banked, plus where he stands today
  // so the most recent stretch is never missing from the chart.
  const series: DevelopmentSeries[] = squad
    .map((member) => {
      const engine = toEnginePlayer(member.player, member.state);
      const history = byPlayer.get(member.player.id) ?? [];

      const points = [
        ...history.map((h) => ({
          season: h.season,
          overall: h.overall,
          age: h.age,
        })),
        { season: career.season, overall: Math.round(engine.overall), age: engine.age },
      ];

      return {
        playerId: member.player.id,
        name: member.player.shortName,
        age: engine.age,
        points,
      };
    })
    .filter((s) => s.points.length > 0);

  const hasHistory = series.some((s) => s.points.length > 1);

  // Movement since the start of the save, which is what people actually want to
  // know: who has come on, and who is going the other way.
  const movement = series
    .map((s) => {
      const first = s.points[0];
      const last = s.points[s.points.length - 1];
      return {
        ...s,
        from: first.overall,
        to: last.overall,
        change: last.overall - first.overall,
      };
    })
    .sort((a, b) => b.change - a.change || b.to - a.to);

  const risers = movement.filter((m) => m.change > 0);
  const fallers = movement.filter((m) => m.change < 0);

  return (
    <div className="space-y-3">
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-6 px-4 py-3">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-[var(--text-dim)]">
              Development
            </p>
            <p className="mt-1 text-[var(--text-muted)]">
              {hasHistory
                ? "How your squad has moved across the save."
                : "One season in. Come back next summer and there will be a line to follow."}
            </p>
          </div>
          <div className="flex gap-8">
            <div className="text-center">
              <p className="numeric text-2xl font-bold text-[var(--good)]">{risers.length}</p>
              <p className="text-[11px] uppercase tracking-wider text-[var(--text-dim)]">
                Improving
              </p>
            </div>
            <div className="text-center">
              <p className="numeric text-2xl font-bold text-[var(--bad)]">{fallers.length}</p>
              <p className="text-[11px] uppercase tracking-wider text-[var(--text-dim)]">
                Declining
              </p>
            </div>
          </div>
        </div>
      </Panel>

      {hasHistory && (
        <Panel title="Rating over time">
          <DevelopmentChart series={series} />
        </Panel>
      )}

      <Panel title="Movement since you took over">
        {movement.length === 0 ? (
          <EmptyState>No players to report on.</EmptyState>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)] text-[11px] uppercase tracking-wider text-[var(--text-dim)]">
                <th className="px-3 py-1.5 text-left">Player</th>
                <th className="px-3 py-1.5 text-right">Age</th>
                <th className="px-3 py-1.5 text-right">Then</th>
                <th className="px-3 py-1.5 text-right">Now</th>
                <th className="px-3 py-1.5 text-right">Change</th>
              </tr>
            </thead>
            <tbody>
              {movement.map((row) => (
                <tr key={row.playerId} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-3 py-1.5">{row.name}</td>
                  <td className="numeric px-3 py-1.5 text-right text-[var(--text-muted)]">
                    {row.age}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Attr value={row.from} />
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Attr value={row.to} />
                  </td>
                  <td
                    className="numeric px-3 py-1.5 text-right font-medium"
                    style={{
                      color:
                        row.change > 0
                          ? "var(--good)"
                          : row.change < 0
                            ? "var(--bad)"
                            : "var(--text-dim)",
                    }}
                  >
                    {row.change > 0 ? "+" : ""}
                    {row.change === 0 ? "-" : row.change}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
