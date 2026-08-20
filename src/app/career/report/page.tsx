/**
 * The post-match report.
 *
 * Where the manager lands at full time. It answers three questions in order:
 * how did each player do, what held up and what did not, and what should the
 * week's training be spent on. The training recommendations are actionable
 * rather than advisory, so the report ends where the next decision begins.
 */

import Link from "next/link";
import { requireCareer } from "@/lib/session";
import { loadMatchReport } from "@/lib/matchService";
import { Button, EmptyState, Panel } from "@/components/ui/primitives";
import { TRAINING_FOCUS_LABELS, type AnalysisVerdict, type PlayerReport } from "@/engine";
import { ApplyTrainingButton } from "@/components/report/ApplyTrainingButton";

export const dynamic = "force-dynamic";

const VERDICT_COLOR: Record<AnalysisVerdict, string> = {
  strong: "var(--elite)",
  solid: "var(--good)",
  adequate: "var(--ok)",
  weak: "var(--bad)",
  poor: "var(--bad)",
};

const VERDICT_LABEL: Record<AnalysisVerdict, string> = {
  strong: "Strong",
  solid: "Solid",
  adequate: "Adequate",
  weak: "Weak",
  poor: "Poor",
};

function ratingColor(rating: number): string {
  if (rating >= 8) return "var(--elite)";
  if (rating >= 7) return "var(--good)";
  if (rating >= 6.3) return "var(--ok)";
  return "var(--bad)";
}

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ fixture?: string }>;
}) {
  const { career, club } = await requireCareer();
  const { fixture } = await searchParams;
  const report = await loadMatchReport(career.id, career.clubId, fixture);

  if (!report) {
    return (
      <Panel title="Match report">
        <EmptyState>
          No report yet. Play a match and it will be waiting here at full time.
        </EmptyState>
      </Panel>
    );
  }

  const ours = report.players.filter((p) => p.clubId === report.clubId);
  const theirs = report.players.filter((p) => p.clubId !== report.clubId);

  const resultColor =
    report.result === "win"
      ? "var(--good)"
      : report.result === "draw"
        ? "var(--ok)"
        : "var(--bad)";

  return (
    <div className="space-y-3">
      {/* ------------------------------------------------------------ header */}
      <Panel>
        <div className="p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wider text-[var(--text-dim)]">
                {report.isHome ? "Home" : "Away"} to {report.opponentName}
              </p>
              <p className="numeric mt-0.5 text-3xl font-bold" style={{ color: resultColor }}>
                {report.goalsFor} - {report.goalsAgainst}
              </p>
            </div>
            <p className="max-w-xl flex-1 text-right text-[var(--text-muted)]">
              {report.headline}
            </p>
          </div>
        </div>
      </Panel>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          {/* ------------------------------------------------------- ratings */}
          <Panel
            title={`${club.name} ratings`}
            action={
              <span className="text-[11px] text-[var(--text-dim)]">
                {ours.length} used
              </span>
            }
          >
            <RatingTable players={ours} motmId={report.manOfTheMatchId} />
          </Panel>

          {/* --------------------------------------------------- performance */}
          <Panel title="How the performance broke down">
            <ul className="divide-y divide-[var(--border)]">
              {report.areas.map((area) => (
                <li key={area.key} className="px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{area.label}</span>
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                      style={{
                        color: VERDICT_COLOR[area.verdict],
                        background: "color-mix(in srgb, currentColor 14%, transparent)",
                      }}
                    >
                      {VERDICT_LABEL[area.verdict]}
                    </span>
                  </div>

                  <div className="mt-1 flex items-center gap-2">
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--border)]">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${area.score}%`,
                          background: VERDICT_COLOR[area.verdict],
                        }}
                      />
                    </span>
                    <span className="numeric w-7 text-right text-[11px] text-[var(--text-dim)]">
                      {area.score}
                    </span>
                  </div>

                  <p className="mt-1 text-[11px] text-[var(--text-muted)]">{area.note}</p>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <div className="space-y-3">
          {/* ------------------------------------------------------ training */}
          <Panel title="What to work on this week">
            {report.recommendedTraining.length === 0 ? (
              <EmptyState>Nothing pressing.</EmptyState>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {report.recommendedTraining.map((rec) => (
                  <li key={rec.focus} className="flex items-start gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{TRAINING_FOCUS_LABELS[rec.focus]}</p>
                      <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{rec.reason}</p>
                    </div>
                    <ApplyTrainingButton focus={rec.focus} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {report.individualWork.length > 0 && (
            <Panel title="Individual attention">
              <ul className="divide-y divide-[var(--border)]">
                {report.individualWork.map((item) => (
                  <li key={item.playerId} className="px-3 py-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <Link
                        href={`/career/player/${item.playerId}`}
                        className="font-medium hover:text-[var(--accent)]"
                      >
                        {item.name}
                      </Link>
                      <span className="shrink-0 text-[11px] text-[var(--accent)]">
                        {TRAINING_FOCUS_LABELS[item.focus]}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{item.reason}</p>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <Panel title="Went well">
              <NoteList notes={report.positives} empty="Not a great deal, in truth." />
            </Panel>

            <Panel title="Needs work">
              <NoteList notes={report.concerns} empty="Nothing badly wrong." />
            </Panel>
          </div>

          <Panel title={`${report.opponentName} ratings`}>
            <RatingTable players={theirs} motmId={report.manOfTheMatchId} compact />
          </Panel>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href="/career/training">
          <Button variant="primary">Set training</Button>
        </Link>
        <Link href="/career/fixtures">
          <Button>Fixtures and results</Button>
        </Link>
        <Link href="/career/squad">
          <Button variant="ghost">Squad</Button>
        </Link>
      </div>
    </div>
  );
}

function NoteList({ notes, empty }: { notes: string[]; empty: string }) {
  if (notes.length === 0) {
    return <p className="px-3 py-3 text-[11px] text-[var(--text-dim)]">{empty}</p>;
  }
  return (
    <ul className="divide-y divide-[var(--border)]">
      {notes.map((note) => (
        <li key={note} className="px-3 py-2 text-[11px] text-[var(--text-muted)]">
          {note}
        </li>
      ))}
    </ul>
  );
}

function RatingTable({
  players,
  motmId,
  compact = false,
}: {
  players: PlayerReport[];
  motmId: number | null;
  compact?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-[var(--border)] text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
            <th className="px-3 py-1.5 font-medium">Player</th>
            <th className="px-1 py-1.5 font-medium">Pos</th>
            <th className="px-1 py-1.5 text-right font-medium">Min</th>
            {!compact && (
              <>
                <th className="px-1 py-1.5 text-right font-medium">G</th>
                <th className="px-1 py-1.5 text-right font-medium">A</th>
                <th className="px-1 py-1.5 text-right font-medium">Sh</th>
              </>
            )}
            <th className="px-3 py-1.5 text-right font-medium">Rating</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr
              key={p.playerId}
              className={`border-b border-[var(--border)] last:border-0 ${
                p.playerId === motmId ? "bg-[rgba(47,129,247,0.08)]" : ""
              }`}
            >
              <td className="px-3 py-1">
                <span className="flex items-center gap-1.5">
                  <Link
                    href={`/career/player/${p.playerId}`}
                    className="truncate hover:text-[var(--accent)]"
                  >
                    {p.name}
                  </Link>
                  {p.playerId === motmId && (
                    <span
                      className="rounded px-1 text-[9px] font-bold text-[var(--accent)]"
                      style={{ background: "rgba(47,129,247,0.18)" }}
                      title="Man of the match"
                    >
                      MOTM
                    </span>
                  )}
                  {p.sentOff && (
                    <span className="text-[9px] font-bold text-[var(--bad)]">RED</span>
                  )}
                  {p.yellowCards > 0 && !p.sentOff && (
                    <span className="text-[9px] font-bold text-[var(--ok)]">YEL</span>
                  )}
                  {p.injured && (
                    <span className="text-[9px] font-bold text-[var(--bad)]">INJ</span>
                  )}
                  {p.cameOn && (
                    <span className="text-[9px] text-[var(--text-dim)]" title="Substitute">
                      sub
                    </span>
                  )}
                </span>
              </td>
              <td className="px-1 py-1 text-[10px] text-[var(--text-dim)]">{p.slot}</td>
              <td className="numeric px-1 py-1 text-right text-[11px] text-[var(--text-muted)]">
                {p.minutes}
              </td>
              {!compact && (
                <>
                  <td className="numeric px-1 py-1 text-right text-[11px]">
                    {p.goals || <span className="text-[var(--text-dim)]">-</span>}
                  </td>
                  <td className="numeric px-1 py-1 text-right text-[11px]">
                    {p.assists || <span className="text-[var(--text-dim)]">-</span>}
                  </td>
                  <td className="numeric px-1 py-1 text-right text-[11px] text-[var(--text-muted)]">
                    {p.shots || <span className="text-[var(--text-dim)]">-</span>}
                  </td>
                </>
              )}
              <td className="px-3 py-1 text-right">
                <span
                  className="numeric rounded px-1.5 py-0.5 text-[11px] font-semibold"
                  style={{
                    color: ratingColor(p.rating),
                    background: "color-mix(in srgb, currentColor 12%, transparent)",
                  }}
                >
                  {p.rating.toFixed(1)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
