import Link from "next/link";
import { requireCareer } from "@/lib/session";
import { loadTable } from "@/lib/tableService";
import { ClubDot, EmptyState, Panel, ResultChip } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

/** Colours the positions that matter at either end of the table. */
function positionAccent(position: number): string | undefined {
  if (position <= 4) return "var(--good)";
  if (position === 5) return "var(--accent)";
  if (position >= 18) return "var(--bad)";
  return undefined;
}

export default async function TablePage() {
  const { career } = await requireCareer();
  const table = await loadTable(career.id);
  const played = table.reduce((sum, row) => sum + row.played, 0) > 0;

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Premier League</h1>

      <Panel bodyClassName="overflow-x-auto">
        {!played ? (
          <EmptyState>No matches have been played yet.</EmptyState>
        ) : (
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                <th className="w-8 px-2 py-1.5 text-right">#</th>
                <th className="px-2 py-1.5 text-left">Club</th>
                <th className="w-9 px-2 py-1.5 text-right">P</th>
                <th className="w-9 px-2 py-1.5 text-right">W</th>
                <th className="w-9 px-2 py-1.5 text-right">D</th>
                <th className="w-9 px-2 py-1.5 text-right">L</th>
                <th className="w-10 px-2 py-1.5 text-right">GF</th>
                <th className="w-10 px-2 py-1.5 text-right">GA</th>
                <th className="w-10 px-2 py-1.5 text-right">GD</th>
                <th className="w-10 px-2 py-1.5 text-right">Pts</th>
                <th className="px-2 py-1.5 text-left">Form</th>
              </tr>
            </thead>
            <tbody>
              {table.map((row, index) => {
                const position = index + 1;
                const isUser = row.clubId === career.clubId;
                return (
                  <tr
                    key={row.clubId}
                    className={`border-b border-[var(--border)] last:border-0 ${
                      isUser ? "bg-[rgba(47,129,247,0.08)]" : "hover:bg-[var(--bg-hover)]"
                    }`}
                  >
                    <td
                      className="numeric border-l-2 px-2 py-1 text-right text-[var(--text-muted)]"
                      style={{ borderColor: positionAccent(position) ?? "transparent" }}
                    >
                      {position}
                    </td>
                    <td className="px-2 py-1">
                      <span className="flex items-center gap-2">
                        <ClubDot color={row.primaryColor} />
                        <span className={isUser ? "font-semibold" : ""}>{row.name}</span>
                      </span>
                    </td>
                    <td className="numeric px-2 py-1 text-right text-[var(--text-muted)]">{row.played}</td>
                    <td className="numeric px-2 py-1 text-right">{row.won}</td>
                    <td className="numeric px-2 py-1 text-right">{row.drawn}</td>
                    <td className="numeric px-2 py-1 text-right">{row.lost}</td>
                    <td className="numeric px-2 py-1 text-right text-[var(--text-muted)]">{row.goalsFor}</td>
                    <td className="numeric px-2 py-1 text-right text-[var(--text-muted)]">{row.goalsAgainst}</td>
                    <td className="numeric px-2 py-1 text-right">
                      {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
                    </td>
                    <td className="numeric px-2 py-1 text-right font-semibold">{row.points}</td>
                    <td className="px-2 py-1">
                      <span className="flex gap-0.5">
                        {row.form.map((result, i) => (
                          <ResultChip key={i} result={result} />
                        ))}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>

      <p className="text-[11px] text-[var(--text-dim)]">
        <span className="mr-3">
          <span className="mr-1 inline-block h-2 w-0.5 align-middle" style={{ background: "var(--good)" }} />
          Champions League
        </span>
        <span className="mr-3">
          <span className="mr-1 inline-block h-2 w-0.5 align-middle" style={{ background: "var(--accent)" }} />
          Europa League
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-0.5 align-middle" style={{ background: "var(--bad)" }} />
          Relegation
        </span>
        <Link href="/career/fixtures" className="ml-4 text-[var(--accent)] hover:underline">
          See all results
        </Link>
      </p>
    </div>
  );
}
