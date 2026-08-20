/**
 * The transfer screen.
 *
 * Three things at once: what the manager can spend, who is available, and what
 * is currently in flight in either direction. Deals take rounds to resolve, so
 * the in-flight list is the part that matters most and sits at the top where a
 * countered bid cannot be missed.
 */

import Link from "next/link";
import { requireCareer } from "@/lib/session";
import { ensureCareerExtras, loadSquad } from "@/lib/careerService";
import {
  formatEur,
  listCompletedTransfers,
  listIncomingOffers,
  listOutgoingOffers,
  listTargets,
  loadFinance,
  transferWindow,
} from "@/lib/transferService";
import { EmptyState, Panel } from "@/components/ui/primitives";
import { TargetList } from "@/components/transfers/TargetList";
import {
  IncomingOfferActions,
  OutgoingOfferActions,
} from "@/components/transfers/OfferActions";
import { TRANSFER } from "@/engine";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, { label: string; color: string }> = {
  pending: { label: "Awaiting reply", color: "var(--ok)" },
  countered: { label: "Counter offer", color: "var(--accent)" },
  agreed: { label: "Fee agreed", color: "var(--accent)" },
  accepted: { label: "Completed", color: "var(--good)" },
  rejected: { label: "Rejected", color: "var(--bad)" },
  player_refused: { label: "Player refused", color: "var(--bad)" },
  withdrawn: { label: "Withdrawn", color: "var(--text-dim)" },
  expired: { label: "Expired", color: "var(--text-dim)" },
};

export default async function TransfersPage() {
  const { career, club } = await requireCareer();
  const round = career.currentRound;
  const window = transferWindow(round);

  // Saves that predate budgets get theirs the first time they come here.
  await ensureCareerExtras(career.id);

  const [finance, squad, targets, outgoing, incoming, completed] = await Promise.all([
    loadFinance(career.id, career.clubId),
    loadSquad(career.id, career.clubId),
    listTargets(career.id, career.clubId, round, { limit: 120 }),
    listOutgoingOffers(career.id, career.clubId),
    listIncomingOffers(career.id, career.clubId),
    listCompletedTransfers(career.id, 20),
  ]);

  const budget = finance?.transferBudget ?? 0;
  const wageRoom = (finance?.wageBudget ?? 0) - (finance?.wageSpend ?? 0);
  const live = outgoing.filter((o) => ["pending", "countered", "agreed"].includes(o.status));
  const settled = outgoing.filter((o) => !["pending", "countered", "agreed"].includes(o.status));

  return (
    <div className="space-y-3">
      {/* ------------------------------------------------------------ status */}
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-[var(--text-dim)]">
              Transfer window
            </p>
            {window.open ? (
              <p className="font-semibold">
                <span className="capitalize">{window.name}</span> window open
                <span className="ml-2 text-[11px] font-normal text-[var(--ok)]">
                  {window.roundsRemaining}{" "}
                  {window.roundsRemaining === 1 ? "round" : "rounds"} left
                </span>
              </p>
            ) : (
              <p className="font-semibold text-[var(--text-muted)]">
                Shut
                <span className="ml-2 text-[11px] font-normal text-[var(--text-dim)]">
                  {window.opensOnRound
                    ? `reopens at round ${window.opensOnRound}`
                    : "no window left this season"}
                </span>
              </p>
            )}
          </div>

          <div className="flex gap-6">
            <Figure label="Transfer budget" value={formatEur(budget)} />
            <Figure
              label="Wage room"
              value={formatEur(Math.max(0, wageRoom))}
              tone={wageRoom <= 0 ? "bad" : undefined}
            />
            <Figure
              label="Squad size"
              value={`${squad.length}`}
              tone={
                squad.length >= TRANSFER.maxSquadSize
                  ? "bad"
                  : squad.length <= TRANSFER.minSquadSize
                    ? "warn"
                    : undefined
              }
              note={`${TRANSFER.minSquadSize} to ${TRANSFER.maxSquadSize}`}
            />
          </div>
        </div>
      </Panel>

      {/* -------------------------------------------------------- in flight */}
      {(incoming.length > 0 || live.length > 0) && (
        <div className="grid gap-3 lg:grid-cols-2">
          {incoming.length > 0 && (
            <Panel title={`Offers for your players (${incoming.length})`}>
              <ul className="divide-y divide-[var(--border)]">
                {incoming.map((offer) => (
                  <li key={offer.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate">
                        <Link
                          href={`/career/player/${offer.playerId}`}
                          className="font-medium hover:text-[var(--accent)]"
                        >
                          {offer.playerName}
                        </Link>
                        <span className="ml-1.5 text-[11px] text-[var(--text-muted)]">
                          to {offer.toClubName}
                        </span>
                      </p>
                      <p className="numeric text-[11px] text-[var(--text-dim)]">
                        {formatEur(offer.feeEur)} fee, {formatEur(offer.wageEur)} a week
                      </p>
                    </div>
                    <IncomingOfferActions offerId={offer.id} />
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {live.length > 0 && (
            <Panel title={`Your bids (${live.length})`}>
              <ul className="divide-y divide-[var(--border)]">
                {live.map((offer) => {
                  const style = STATUS_STYLE[offer.status] ?? STATUS_STYLE.pending;
                  return (
                    <li key={offer.id} className="flex items-start gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate">
                          <Link
                            href={`/career/player/${offer.playerId}`}
                            className="font-medium hover:text-[var(--accent)]"
                          >
                            {offer.playerName}
                          </Link>
                          <span className="ml-1.5 text-[11px] text-[var(--text-muted)]">
                            from {offer.fromClubName}
                          </span>
                        </p>
                        <p className="numeric text-[11px] text-[var(--text-dim)]">
                          {formatEur(offer.feeEur)} offered
                          {offer.counterFeeEur !== null && (
                            <span className="text-[var(--accent)]">
                              {" "}
                              · they want {formatEur(offer.counterFeeEur)}
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 text-[11px]" style={{ color: style.color }}>
                          {offer.responseNote ?? style.label}
                        </p>
                      </div>
                      <OutgoingOfferActions offerId={offer.id} status={offer.status} />
                    </li>
                  );
                })}
              </ul>
            </Panel>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------- scouting */}
      <Panel
        title="Available players"
        action={
          <span className="text-[11px] text-[var(--text-dim)]">
            {window.open
              ? "Bids are answered the following round"
              : "The window is shut, but you can still look"}
          </span>
        }
      >
        <TargetList
          targets={targets}
          budget={budget}
          wageRoom={Math.max(0, wageRoom)}
          windowOpen={window.open}
        />
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        {settled.length > 0 && (
          <Panel title="Concluded business">
            <ul className="divide-y divide-[var(--border)]">
              {settled.slice(0, 12).map((offer) => {
                const style = STATUS_STYLE[offer.status] ?? STATUS_STYLE.rejected;
                return (
                  <li key={offer.id} className="px-3 py-1.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate">{offer.playerName}</span>
                      <span className="shrink-0 text-[10px] uppercase" style={{ color: style.color }}>
                        {style.label}
                      </span>
                    </div>
                    {offer.responseNote && (
                      <p className="text-[11px] text-[var(--text-dim)]">{offer.responseNote}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </Panel>
        )}

        <Panel title="Around the league">
          {completed.length === 0 ? (
            <EmptyState>No deals done yet.</EmptyState>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {completed.map((deal) => (
                <li
                  key={deal.id}
                  className={`flex items-center gap-2 px-3 py-1.5 text-[11px] ${
                    deal.toClubId === career.clubId || deal.fromClubId === career.clubId
                      ? "bg-[rgba(47,129,247,0.07)]"
                      : ""
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium text-[var(--text)]">{deal.playerName}</span>
                    <span className="text-[var(--text-dim)]">
                      {" "}
                      {deal.fromClubName} to {deal.toClubName}
                    </span>
                  </span>
                  <span className="numeric shrink-0 text-[var(--text-muted)]">
                    {formatEur(deal.feeEur)}
                  </span>
                  <span className="numeric w-8 shrink-0 text-right text-[var(--text-dim)]">
                    r{deal.round}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <p className="text-[11px] text-[var(--text-dim)]">
        {club.name} can carry between {TRANSFER.minSquadSize} and {TRANSFER.maxSquadSize}{" "}
        players. Windows run rounds {TRANSFER.summerWindow[0]} to {TRANSFER.summerWindow[1]}{" "}
        and {TRANSFER.januaryWindow[0]} to {TRANSFER.januaryWindow[1]}.
      </p>
    </div>
  );
}

function Figure({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "bad" | "warn";
}) {
  const color = tone === "bad" ? "var(--bad)" : tone === "warn" ? "var(--ok)" : "var(--text)";
  return (
    <div className="text-right">
      <p className="text-[11px] uppercase tracking-wider text-[var(--text-dim)]">{label}</p>
      <p className="numeric font-semibold" style={{ color }}>
        {value}
      </p>
      {note && <p className="text-[10px] text-[var(--text-dim)]">{note}</p>}
    </div>
  );
}
