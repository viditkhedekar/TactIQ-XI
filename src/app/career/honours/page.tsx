/**
 * The trophy cabinet.
 *
 * Split into what the manager himself won and what happened around him, because
 * a save that runs for years accumulates a lot of other people's titles and the
 * point of a cabinet is the shelf with your own name on it.
 */

import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { careerHonours, clubs, players } from "@/db/schema";
import { requireCareer } from "@/lib/session";
import { loadSeasonHistory } from "@/lib/seasonService";
import { ClubDot, EmptyState, Panel } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

/** How each honour is described, and whether it is worth celebrating. */
const HONOUR: Record<string, { label: string; major: boolean; icon: string }> = {
  league_title: { label: "League champions", major: true, icon: "🏆" },
  cup_winner: { label: "Cup winners", major: true, icon: "🏆" },
  league_runner_up: { label: "League runners-up", major: false, icon: "🥈" },
  cup_runner_up: { label: "Cup runners-up", major: false, icon: "🥈" },
  promoted: { label: "Promoted", major: false, icon: "⬆" },
  golden_boot: { label: "Golden Boot", major: false, icon: "⚽" },
  most_assists: { label: "Most assists", major: false, icon: "🅰" },
  player_of_season: { label: "Player of the season", major: false, icon: "⭐" },
};

const INDIVIDUAL = new Set(["golden_boot", "most_assists", "player_of_season"]);

export default async function HonoursPage() {
  const { career, club } = await requireCareer();

  const honours = await db
    .select()
    .from(careerHonours)
    .where(eq(careerHonours.careerId, career.id))
    .orderBy(desc(careerHonours.season));

  const history = await loadSeasonHistory(career.id);

  const clubIds = [...new Set(honours.map((h) => h.clubId))];
  const playerIds = honours.map((h) => h.playerId).filter((id): id is number => id !== null);

  const [clubRows, playerRows] = await Promise.all([
    clubIds.length > 0
      ? db
          .select({ id: clubs.id, name: clubs.name, primaryColor: clubs.primaryColor })
          .from(clubs)
          .where(inArray(clubs.id, clubIds))
      : Promise.resolve([]),
    playerIds.length > 0
      ? db
          .select({ id: players.id, name: players.shortName })
          .from(players)
          .where(inArray(players.id, playerIds))
      : Promise.resolve([]),
  ]);

  const clubById = new Map(clubRows.map((c) => [c.id, c]));
  const playerById = new Map(playerRows.map((p) => [p.id, p]));

  const mine = honours.filter((h) => h.isUser);
  const majors = mine.filter((h) => HONOUR[h.type]?.major);

  // The manager's own finishing position each season, which is the honest
  // record of a career even in the years nothing was won.
  const ownHistory = history.filter((row) => row.clubId === career.clubId);

  return (
    <div className="space-y-3">
      {/* ------------------------------------------------------- headline */}
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-6 px-4 py-4">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-[var(--text-dim)]">
              Trophy cabinet
            </p>
            <h1 className="mt-1 flex items-center gap-2 text-xl font-bold">
              <ClubDot color={club.primaryColor} />
              {career.username}
            </h1>
            <p className="mt-1 text-[12px] text-[var(--text-muted)]">
              {career.season === 1
                ? "Season one, still to be written."
                : `${career.season - 1} completed ${career.season - 1 === 1 ? "season" : "seasons"}.`}
            </p>
          </div>

          <div className="flex gap-8">
            <div className="text-center">
              <p className="numeric text-3xl font-bold text-[var(--good)]">
                {majors.length}
              </p>
              <p className="text-[11px] uppercase tracking-wider text-[var(--text-dim)]">
                Major honours
              </p>
            </div>
            <div className="text-center">
              <p className="numeric text-3xl font-bold">{mine.length}</p>
              <p className="text-[11px] uppercase tracking-wider text-[var(--text-dim)]">
                In total
              </p>
            </div>
          </div>
        </div>
      </Panel>

      {/* --------------------------------------------------------- yours */}
      <Panel title="Won under you">
        {mine.length === 0 ? (
          <EmptyState>Nothing yet. There is a season to go and win.</EmptyState>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {mine.map((honour) => {
              const meta = HONOUR[honour.type] ?? {
                label: honour.type,
                major: false,
                icon: "•",
              };
              const player = honour.playerId ? playerById.get(honour.playerId) : null;

              return (
                <div key={honour.id} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="text-lg leading-none">{meta.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className={meta.major ? "font-semibold" : ""}>
                      {meta.label}
                      {player && (
                        <span className="ml-1.5 text-[var(--text-muted)]">
                          — {player.name}
                          {honour.value !== null && INDIVIDUAL.has(honour.type)
                            ? ` (${honour.type === "player_of_season" ? honour.value.toFixed(2) : honour.value})`
                            : ""}
                        </span>
                      )}
                    </p>
                  </div>
                  <span className="numeric shrink-0 text-[11px] text-[var(--text-dim)]">
                    Season {honour.season}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* ------------------------------------------------------- record */}
      <Panel title="Season by season">
        {ownHistory.length === 0 ? (
          <EmptyState>No completed seasons yet.</EmptyState>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)] text-[11px] uppercase tracking-wider text-[var(--text-dim)]">
                <th className="px-3 py-1.5 text-left">Season</th>
                <th className="px-3 py-1.5 text-right">Pos</th>
                <th className="px-3 py-1.5 text-right">P</th>
                <th className="px-3 py-1.5 text-right">W</th>
                <th className="px-3 py-1.5 text-right">D</th>
                <th className="px-3 py-1.5 text-right">L</th>
                <th className="px-3 py-1.5 text-right">GD</th>
                <th className="px-3 py-1.5 text-right">Pts</th>
                <th className="px-3 py-1.5 text-left"></th>
              </tr>
            </thead>
            <tbody>
              {ownHistory.map((row) => (
                <tr key={row.season} className="border-b border-[var(--border)] last:border-0">
                  <td className="numeric px-3 py-1.5">{row.season}</td>
                  <td className="numeric px-3 py-1.5 text-right font-medium">{row.position}</td>
                  <td className="numeric px-3 py-1.5 text-right">{row.played}</td>
                  <td className="numeric px-3 py-1.5 text-right">{row.won}</td>
                  <td className="numeric px-3 py-1.5 text-right">{row.drawn}</td>
                  <td className="numeric px-3 py-1.5 text-right">{row.lost}</td>
                  <td className="numeric px-3 py-1.5 text-right">
                    {row.goalsFor - row.goalsAgainst > 0 ? "+" : ""}
                    {row.goalsFor - row.goalsAgainst}
                  </td>
                  <td className="numeric px-3 py-1.5 text-right font-semibold">{row.points}</td>
                  <td className="px-3 py-1.5">
                    {row.outcome === "champion" && (
                      <span className="text-[11px] text-[var(--good)]">Champions</span>
                    )}
                    {row.outcome === "relegated" && (
                      <span className="text-[11px] text-[var(--bad)]">Relegated</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {/* ------------------------------------------------ everybody else */}
      <Panel title="Elsewhere">
        {honours.filter((h) => !h.isUser).length === 0 ? (
          <EmptyState>Nothing has been decided yet.</EmptyState>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {honours
              .filter((h) => !h.isUser && HONOUR[h.type]?.major)
              .map((honour) => {
                const meta = HONOUR[honour.type];
                const honourClub = clubById.get(honour.clubId);
                return (
                  <div key={honour.id} className="flex items-center gap-3 px-3 py-2">
                    <span className="opacity-50">{meta.icon}</span>
                    <span className="flex min-w-0 flex-1 items-center gap-2 text-[var(--text-muted)]">
                      {honourClub && <ClubDot color={honourClub.primaryColor} />}
                      {honourClub?.name ?? "Unknown"} — {meta.label.toLowerCase()}
                    </span>
                    <span className="numeric shrink-0 text-[11px] text-[var(--text-dim)]">
                      Season {honour.season}
                    </span>
                  </div>
                );
              })}
          </div>
        )}
      </Panel>
    </div>
  );
}
