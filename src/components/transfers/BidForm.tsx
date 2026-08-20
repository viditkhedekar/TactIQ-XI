"use client";

import { useActionState, useState } from "react";
import { makeOfferAction } from "@/app/actions";
import { Button } from "@/components/ui/primitives";

/**
 * The bid dialog.
 *
 * Prefilled with the asking price and the player's wage demand, because those
 * are the numbers that get the deal done and the manager should have to think
 * only about whether to go lower. Going lower is the interesting decision, so
 * the form says plainly what it risks.
 */
export function BidForm({
  playerId,
  playerName,
  clubName,
  askingPrice,
  wageDemand,
  budget,
  wageRoom,
  onClose,
}: {
  playerId: number;
  playerName: string;
  clubName: string;
  askingPrice: number;
  wageDemand: number;
  budget: number;
  wageRoom: number;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(makeOfferAction, null);
  const [fee, setFee] = useState(Math.min(askingPrice, budget));
  const [wage, setWage] = useState(Math.min(wageDemand, wageRoom));

  const share = askingPrice > 0 ? fee / askingPrice : 1;
  const feeVerdict =
    share >= 1
      ? { text: "Meets their valuation. They should accept.", color: "var(--good)" }
      : share >= 0.82
        ? { text: "Below their valuation. Expect a counter offer.", color: "var(--ok)" }
        : { text: "Well short. They will turn this down flat.", color: "var(--bad)" };

  const wageVerdict =
    wage >= wageDemand
      ? { text: "Enough to persuade him.", color: "var(--good)" }
      : { text: "Below what he wants. He will refuse the move.", color: "var(--bad)" };

  const overBudget = fee > budget;
  const overWages = wage > wageRoom;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-md border border-[var(--border-strong)] bg-[var(--bg-raised)] shadow-xl">
        <header className="flex items-baseline justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate font-semibold">{playerName}</h2>
            <p className="text-[11px] text-[var(--text-dim)]">{clubName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-[var(--text-dim)] hover:text-[var(--text)]"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <form action={action} className="space-y-4 p-4">
          <input type="hidden" name="playerId" value={playerId} />
          <input type="hidden" name="feeEur" value={Math.round(fee)} />
          <input type="hidden" name="wageEur" value={Math.round(wage)} />

          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="fee" className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Transfer fee
              </label>
              <span className="numeric font-semibold">{formatEur(fee)}</span>
            </div>
            <input
              id="fee"
              type="range"
              min={Math.round(askingPrice * 0.4)}
              max={Math.round(Math.max(askingPrice * 1.3, askingPrice * 0.4 + 1))}
              step={100_000}
              value={fee}
              onChange={(e) => setFee(Number(e.target.value))}
              className="mt-1.5 w-full accent-[var(--accent)]"
            />
            <p className="mt-1 text-[11px]" style={{ color: feeVerdict.color }}>
              {feeVerdict.text}
            </p>
            <p className="text-[11px] text-[var(--text-dim)]">
              They want {formatEur(askingPrice)}. You have {formatEur(budget)}.
            </p>
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="wage" className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Weekly wage
              </label>
              <span className="numeric font-semibold">{formatEur(wage)}</span>
            </div>
            <input
              id="wage"
              type="range"
              min={Math.round(wageDemand * 0.5)}
              max={Math.round(Math.max(wageDemand * 1.5, wageDemand * 0.5 + 1))}
              step={1_000}
              value={wage}
              onChange={(e) => setWage(Number(e.target.value))}
              className="mt-1.5 w-full accent-[var(--accent)]"
            />
            <p className="mt-1 text-[11px]" style={{ color: wageVerdict.color }}>
              {wageVerdict.text}
            </p>
            <p className="text-[11px] text-[var(--text-dim)]">
              He wants {formatEur(wageDemand)} a week. You have {formatEur(wageRoom)} of room.
            </p>
          </div>

          {state?.error && <p className="text-[11px] text-[var(--bad)]">{state.error}</p>}
          {state?.message && <p className="text-[11px] text-[var(--good)]">{state.message}</p>}

          <div className="flex items-center gap-2">
            <Button
              type="submit"
              variant="primary"
              disabled={pending || overBudget || overWages}
            >
              {pending ? "Submitting..." : "Submit bid"}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>

          {(overBudget || overWages) && (
            <p className="text-[11px] text-[var(--bad)]">
              {overBudget ? "That is more than your transfer budget." : "No room in the wage budget."}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}

/** Kept local so this stays a client component with no server import. */
function formatEur(amount: number): string {
  if (amount >= 1_000_000) {
    const millions = amount / 1_000_000;
    return `€${millions >= 100 ? Math.round(millions) : millions.toFixed(1)}m`;
  }
  if (amount >= 1_000) return `€${Math.round(amount / 1_000)}k`;
  return `€${Math.round(amount)}`;
}
