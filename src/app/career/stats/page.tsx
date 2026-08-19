import Link from "next/link";
import { requireCareer } from "@/lib/session";
import { loadLeaders, type LeaderRow } from "@/lib/tableService";
import { ClubDot, EmptyState, Panel } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

function LeaderBoard({
  title,
  rows,
  format,
  note,
}: {
  title: string;
  rows: LeaderRow[];
  format: (value: number) => string;
  note?: string;
}) {
  return (
    <Panel title={title} action={note ? <span className="text-[11px] text-[var(--text-dim)]">{note}</span> : null}>
      {rows.length === 0 ? (
        <EmptyState>Nothing to show yet.</EmptyState>
      ) : (
        <ol>
          {rows.map((row, index) => (
            <li
              key={row.playerId}
              className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-1 last:border-0 hover:bg-[var(--bg-hover)]"
            >
              <span className="numeric w-5 text-right text-[11px] text-[var(--text-dim)]">
                {index + 1}
              </span>
              <Link
                href={`/career/player/${row.playerId}`}
                className="min-w-0 flex-1 truncate font-medium hover:text-[var(--accent)] hover:underline"
              >
                {row.name}
              </Link>
              <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                <ClubDot color={row.clubColor} />
                <span className="hidden sm:inline">{row.clubName}</span>
              </span>
              <span className="numeric w-8 shrink-0 text-right text-[11px] text-[var(--text-dim)]">
                {row.apps}
              </span>
              <span className="numeric w-10 shrink-0 text-right font-semibold">
                {format(row.value)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

export default async function StatsPage() {
  const { career } = await requireCareer();

  const [scorers, assisters, rated] = await Promise.all([
    loadLeaders(career.id, "goals"),
    loadLeaders(career.id, "assists"),
    loadLeaders(career.id, "rating"),
  ]);

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Season statistics</h1>

      <div className="grid gap-3 lg:grid-cols-3">
        <LeaderBoard title="Goals" rows={scorers} format={(v) => String(v)} />
        <LeaderBoard title="Assists" rows={assisters} format={(v) => String(v)} />
        <LeaderBoard
          title="Average rating"
          rows={rated}
          format={(v) => v.toFixed(2)}
          note="5 apps minimum"
        />
      </div>

      <p className="text-[11px] text-[var(--text-dim)]">
        The middle column of each list is appearances.
      </p>
    </div>
  );
}
