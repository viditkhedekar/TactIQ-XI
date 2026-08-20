/**
 * End of season.
 *
 * Shown once round 38 is settled and before anything is rolled over, so the
 * manager sees where he finished while it still counts as this season. The
 * button at the bottom is what actually ages everybody and redraws the fixture
 * list; until it is pressed the save sits here.
 */

import { redirect } from "next/navigation";
import { requireCareer } from "@/lib/session";
import { buildLeagueTable, loadDivision } from "@/lib/seasonService";
import { cupProgressFor } from "@/lib/cupService";
import { ROLLOVER, ordinal } from "@/engine";
import { ClubDot, Panel } from "@/components/ui/primitives";
import { StartNextSeasonButton } from "@/components/season/StartNextSeasonButton";
import { db } from "@/db/client";
import { clubs } from "@/db/schema";
import { inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function SeasonReviewPage() {
  const { career, club } = await requireCareer();

  // Only meaningful at the end of a season; any other time the manager belongs
  // back in the game rather than looking at a review of nothing.
  if (career.phase !== "season_over") redirect("/career/squad");

  const [table, cup] = await Promise.all([
    buildLeagueTable(career.id, career.season),
    cupProgressFor(career.id, career.season, career.clubId),
  ]);

  const own = table.find((r) => r.clubId === career.clubId);
  const position = own?.position ?? table.length;
  const beatExpectation = position < career.expectedPosition;
  const relegationZone = position > table.length - ROLLOVER.relegated;

  const division = await loadDivision(career.id, career.season);
  const clubRows = await db
    .select({ id: clubs.id, name: clubs.name, primaryColor: clubs.primaryColor })
    .from(clubs)
    .where(inArray(clubs.id, division));
  const clubById = new Map(clubRows.map((c) => [c.id, c]));

  const headline = relegationZone
    ? "Relegated."
    : position === 1
      ? "Champions."
      : beatExpectation
        ? "Better than they asked for."
        : position === career.expectedPosition
          ? "Exactly as expected."
          : "Short of what they wanted.";

  return (
    <div className="space-y-3">
      <Panel>
        <div className="px-4 py-5">
          <p className="text-[11px] uppercase tracking-wider text-[var(--text-dim)]">
            Season {career.season} · final
          </p>
          <h1 className="mt-1 text-3xl font-bold">{headline}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-[var(--text-muted)]">
            <ClubDot color={club.primaryColor} />
            {club.name} finished {ordinal(position)}
            <span className="text-[var(--text-dim)]">·</span>
            {own?.points ?? 0} points
            <span className="text-[var(--text-dim)]">·</span>
            they expected {ordinal(career.expectedPosition)}
          </p>
          {relegationZone && (
            <p className="mt-3 rounded border border-[var(--bad)] bg-[rgba(248,81,73,0.08)] px-3 py-2 text-[12px] text-[var(--bad)]">
              Going down costs a manager his job. The board will not be keeping you on.
            </p>
          )}
        </div>
      </Panel>

      <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
        <Panel title="Final table">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)] text-[11px] uppercase tracking-wider text-[var(--text-dim)]">
                <th className="px-3 py-1.5 text-left">#</th>
                <th className="px-3 py-1.5 text-left">Club</th>
                <th className="px-3 py-1.5 text-right">P</th>
                <th className="px-3 py-1.5 text-right">GD</th>
                <th className="px-3 py-1.5 text-right">Pts</th>
              </tr>
            </thead>
            <tbody>
              {table.map((row) => {
                const isUser = row.clubId === career.clubId;
                const goingDown = row.position > table.length - ROLLOVER.relegated;
                return (
                  <tr
                    key={row.clubId}
                    className="border-b border-[var(--border)] last:border-0"
                    style={isUser ? { background: "var(--bg-hover)" } : undefined}
                  >
                    <td
                      className="numeric px-3 py-1.5"
                      style={{
                        color: row.position === 1
                          ? "var(--good)"
                          : goingDown
                            ? "var(--bad)"
                            : undefined,
                      }}
                    >
                      {row.position}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className={`flex items-center gap-2 ${isUser ? "font-semibold" : ""}`}>
                        <ClubDot color={clubById.get(row.clubId)?.primaryColor ?? "#888"} />
                        {row.clubName}
                      </span>
                    </td>
                    <td className="numeric px-3 py-1.5 text-right">{row.played}</td>
                    <td className="numeric px-3 py-1.5 text-right">
                      {row.goalsFor - row.goalsAgainst > 0 ? "+" : ""}
                      {row.goalsFor - row.goalsAgainst}
                    </td>
                    <td className="numeric px-3 py-1.5 text-right font-semibold">{row.points}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>

        <div className="space-y-3">
          <Panel title="The cup">
            <div className="px-3 py-2.5 text-[12px]">
              {cup.won ? (
                <p className="text-[var(--good)]">You won it.</p>
              ) : cup.reached ? (
                <p className="text-[var(--text-muted)]">
                  Out in the {cup.reached.toLowerCase()}
                  {cup.giantKilled ? ", to a club from below the division." : "."}
                </p>
              ) : (
                <p className="text-[var(--text-muted)]">Nothing to report.</p>
              )}
            </div>
          </Panel>

          <Panel title="What happens next">
            <div className="space-y-2 px-3 py-2.5 text-[12px] text-[var(--text-muted)]">
              <p>
                The bottom {ROLLOVER.relegated} go down and {ROLLOVER.relegated} come up
                from the division below.
              </p>
              <p>
                Every player gets a year older. The young improve, the old slow down,
                and some hang their boots up altogether.
              </p>
            </div>
            <div className="border-t border-[var(--border)] p-3">
              <StartNextSeasonButton relegated={relegationZone} />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
