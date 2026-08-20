import { requireCareer } from "@/lib/session";
import { loadFixtures } from "@/lib/tableService";
import { ClubDot, Panel } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

export default async function FixturesPage() {
  const { career } = await requireCareer();
  const all = await loadFixtures(career.id, career.season);

  const byRound = new Map<number, typeof all>();
  for (const fixture of all) {
    if (!byRound.has(fixture.round)) byRound.set(fixture.round, []);
    byRound.get(fixture.round)!.push(fixture);
  }

  // Open on the round just played, since that is what the manager wants to see
  // after clicking Continue.
  const focusRound = Math.max(1, Math.min(38, career.currentRound - 1));

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Fixtures and results</h1>

      <div className="grid gap-3 lg:grid-cols-2">
        {[...byRound.entries()].map(([round, matches]) => {
          const isFocus = round === focusRound;
          const isNext = round === career.currentRound;

          return (
            <Panel
              key={round}
              className={isFocus || isNext ? "ring-1 ring-[var(--border-strong)]" : ""}
              title={
                <span className="flex items-center gap-2">
                  Round {round}
                  {isNext && (
                    <span className="rounded bg-[rgba(47,129,247,0.15)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
                      NEXT
                    </span>
                  )}
                </span>
              }
              action={
                matches[0]?.kickoffDate ? (
                  <span className="text-[11px] text-[var(--text-dim)]">
                    {DATE_FORMAT.format(new Date(matches[0].kickoffDate))}
                  </span>
                ) : null
              }
            >
              <ul>
                {matches.map((fixture) => {
                  const involvesUser =
                    fixture.homeClubId === career.clubId || fixture.awayClubId === career.clubId;
                  const finished = fixture.status === "finished";

                  return (
                    <li
                      key={fixture.id}
                      className={`flex items-center gap-2 border-b border-[var(--border)] px-3 py-1 last:border-0 ${
                        involvesUser ? "bg-[rgba(47,129,247,0.07)]" : ""
                      }`}
                    >
                      <span className="flex min-w-0 flex-1 items-center justify-end gap-1.5 text-right">
                        <span className={`truncate ${involvesUser ? "font-medium" : ""}`}>
                          {fixture.homeName}
                        </span>
                        <ClubDot color={fixture.homeColor} />
                      </span>

                      <span className="numeric w-12 shrink-0 text-center">
                        {finished ? (
                          <span className="font-semibold">
                            {fixture.homeGoals} - {fixture.awayGoals}
                          </span>
                        ) : (
                          <span className="text-[var(--text-dim)]">v</span>
                        )}
                      </span>

                      <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        <ClubDot color={fixture.awayColor} />
                        <span className={`truncate ${involvesUser ? "font-medium" : ""}`}>
                          {fixture.awayName}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
