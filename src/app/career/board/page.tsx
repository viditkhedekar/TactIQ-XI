/**
 * The boardroom.
 *
 * What they expect, what they make of the job so far, and what can be asked of
 * them. When a manager has been dismissed this same screen becomes the list of
 * clubs willing to take him on, because being out of work is a state of the
 * relationship with a board rather than a separate part of the game.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { careerClubFinance } from "@/db/schema";
import { requireCareer } from "@/lib/session";
import { ensureCareerExtras, loadSquad } from "@/lib/careerService";
import { loadBoardView, loadJobOffers, loadRequests } from "@/lib/boardService";
import { cupProgressFor } from "@/lib/cupService";
import { BOARD, ordinal } from "@/engine";
import { ClubDot, EmptyState, Panel } from "@/components/ui/primitives";
import { BoardRequests } from "@/components/board/BoardRequests";
import { SellRequestPicker } from "@/components/board/SellRequestPicker";
import { JobOfferList } from "@/components/board/JobOfferList";

export const dynamic = "force-dynamic";

const VERDICT_COLOR: Record<string, string> = {
  delighted: "var(--good)",
  pleased: "var(--good)",
  content: "var(--ok)",
  concerned: "var(--bad)",
  furious: "var(--bad)",
};

function formatEur(value: number): string {
  if (value >= 1_000_000) return `€${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `€${Math.round(value / 1_000)}k`;
  return `€${value}`;
}

export default async function BoardPage() {
  const { career, club } = await requireCareer();
  await ensureCareerExtras(career.id);

  /* --------------------------------------------------------- out of work */

  if (career.phase === "sacked") {
    const offers = await loadJobOffers(career.id);
    return (
      <div className="space-y-3">
        <Panel>
          <div className="px-4 py-5">
            <p className="text-[11px] uppercase tracking-wider text-[var(--bad)]">
              Dismissed
            </p>
            <h1 className="mt-1 text-2xl font-bold">
              {club.name} have relieved you of your duties
            </h1>
            <p className="mt-2 max-w-2xl text-[var(--text-muted)]">
              Your record, your honours and everything you built stay with you. What
              you need now is somebody willing to give you another go.
            </p>
          </div>
        </Panel>

        {offers.length === 0 ? (
          <Panel title="Offers">
            <EmptyState>
              Nobody is interested at the moment. That is the end of this career.
            </EmptyState>
          </Panel>
        ) : (
          <JobOfferList offers={offers} />
        )}
      </div>
    );
  }

  /* ------------------------------------------------------------ in a job */

  const [view, requests, squad, cup] = await Promise.all([
    loadBoardView(career),
    loadRequests(career.id, career.season),
    loadSquad(career.id, career.clubId),
    cupProgressFor(career.id, career.season, career.clubId),
  ]);

  const [finance] = await db
    .select()
    .from(careerClubFinance)
    .where(
      and(
        eq(careerClubFinance.careerId, career.id),
        eq(careerClubFinance.clubId, career.clubId),
      ),
    )
    .limit(1);

  const wageRoom = (finance?.wageBudget ?? 0) - (finance?.wageSpend ?? 0);

  return (
    <div className="space-y-3">
      {/* ------------------------------------------------------- headline */}
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-6 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-[var(--text-dim)]">
              The board
            </p>
            <p className="mt-1 flex items-center gap-2 font-semibold">
              <ClubDot color={club.primaryColor} />
              {club.name}
            </p>
            <p className="mt-1.5 max-w-xl text-[var(--text-muted)]">{view.summary}</p>
          </div>

          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-wider text-[var(--text-dim)]">
                Expected
              </p>
              <p className="numeric text-xl font-semibold">
                {ordinal(view.expectedPosition)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-wider text-[var(--text-dim)]">
                Confidence
              </p>
              <p
                className="numeric text-2xl font-bold"
                style={{
                  color:
                    view.confidence >= 62
                      ? "var(--good)"
                      : view.confidence >= BOARD.sackThreshold
                        ? "var(--ok)"
                        : "var(--bad)",
                }}
              >
                {Math.round(view.confidence)}
              </p>
            </div>
          </div>
        </div>

        {view.underPressure && (
          <div className="border-t border-[var(--border)] bg-[rgba(248,81,73,0.06)] px-4 py-2.5">
            <p className="text-[12px] text-[var(--bad)]">
              {view.roundsInDanger > 0
                ? `You have been under review for ${view.roundsInDanger} ${
                    view.roundsInDanger === 1 ? "round" : "rounds"
                  }. ${view.roundsBeforeSacking - view.roundsInDanger} more like this and they will act.`
                : "The board has made its concerns public."}
            </p>
          </div>
        )}
      </Panel>

      <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          {/* --------------------------------------------------- the areas */}
          <Panel title="What they are judging you on">
            <div className="divide-y divide-[var(--border)]">
              {view.areas.map((area) => (
                <div key={area.key} className="px-3 py-2.5">
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-medium">{area.label}</span>
                    <span
                      className="text-[11px] uppercase tracking-wider"
                      style={{ color: VERDICT_COLOR[area.verdict] }}
                    >
                      {area.verdict}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded bg-[var(--border)]">
                    <div
                      className="h-full rounded"
                      style={{
                        width: `${area.score}%`,
                        background: VERDICT_COLOR[area.verdict],
                      }}
                    />
                  </div>
                  <p className="mt-1.5 text-[12px] text-[var(--text-muted)]">{area.note}</p>
                </div>
              ))}
            </div>
          </Panel>

          {/* ------------------------------------------------ past requests */}
          <Panel title="Recent conversations">
            {requests.length === 0 ? (
              <EmptyState>You have not asked them for anything yet.</EmptyState>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {requests.map((request) => (
                  <div key={request.id} className="flex items-start gap-3 px-3 py-2">
                    <span
                      className="mt-1 shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider"
                      style={{
                        color:
                          request.outcome === "granted"
                            ? "var(--good)"
                            : request.outcome === "partial"
                              ? "var(--ok)"
                              : "var(--bad)",
                        background: "var(--bg-hover)",
                      }}
                    >
                      {request.outcome}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[12px]">{request.response}</p>
                      <p className="mt-0.5 text-[11px] text-[var(--text-dim)]">
                        Round {request.round}
                        {request.amountEur
                          ? ` · asked for ${formatEur(Number(request.amountEur))}`
                          : ""}
                        {request.grantedEur
                          ? ` · got ${formatEur(Number(request.grantedEur))}`
                          : ""}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        {/* ----------------------------------------------------- requests */}
        <div className="space-y-3">
          <BoardRequests
            transferBudget={finance?.transferBudget ?? 0}
            wageRoom={wageRoom}
          />

          <SellRequestPicker
            players={squad.map((m) => ({
              id: m.player.id,
              name: m.player.shortName,
              overall: m.player.overall,
            }))}
          />

          <Panel title="This season">
            <div className="space-y-1.5 px-3 py-2.5 text-[12px]">
              <p className="flex justify-between">
                <span className="text-[var(--text-muted)]">Transfer budget</span>
                <span className="numeric">{formatEur(finance?.transferBudget ?? 0)}</span>
              </p>
              <p className="flex justify-between">
                <span className="text-[var(--text-muted)]">Wage room</span>
                <span className="numeric">{formatEur(wageRoom)}</span>
              </p>
              <p className="flex justify-between">
                <span className="text-[var(--text-muted)]">Cup</span>
                <span>
                  {cup.won
                    ? "Winners"
                    : cup.stillIn
                      ? `In the ${cup.reached ?? "draw"}`
                      : cup.reached
                        ? `Out in the ${cup.reached.toLowerCase()}`
                        : "Not started"}
                </span>
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
