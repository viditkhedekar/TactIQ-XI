"use client";

import { useActionState, useState } from "react";
import { requestFundsAction, type OfferState } from "@/app/actions";
import { Button, Panel } from "@/components/ui/primitives";

/** Rounds a figure to something a manager would actually say out loud. */
function formatEur(value: number): string {
  if (value >= 1_000_000) return `€${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `€${Math.round(value / 1_000)}k`;
  return `€${value}`;
}

/**
 * Asking the board for money.
 *
 * The two requests share a form because they are the same conversation with a
 * different noun, and the preset amounts exist because the interesting decision
 * is how boldly to ask, not typing a number.
 */
export function BoardRequests({
  transferBudget,
  wageRoom,
}: {
  transferBudget: number;
  wageRoom: number;
}) {
  const [state, formAction, pending] = useActionState<OfferState, FormData>(
    requestFundsAction,
    null,
  );
  const [type, setType] = useState<"transfer_funds" | "wage_room">("transfer_funds");

  const base = type === "transfer_funds" ? Math.max(transferBudget, 10_000_000) : Math.max(wageRoom, 50_000);
  const options = [0.25, 0.5, 1].map((share) => Math.round((base * share) / 100_000) * 100_000);
  const [amount, setAmount] = useState(options[0]);

  return (
    <Panel title="Ask the board">
      <form action={formAction} className="space-y-3 p-3">
        <div className="flex gap-px overflow-hidden rounded border border-[var(--border-strong)]">
          {(
            [
              ["transfer_funds", "Transfer funds"],
              ["wage_room", "Wage room"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setType(value);
                const next =
                  value === "transfer_funds"
                    ? Math.max(transferBudget, 10_000_000)
                    : Math.max(wageRoom, 50_000);
                setAmount(Math.round((next * 0.25) / 100_000) * 100_000);
              }}
              className={`flex-1 px-3 py-1.5 text-[12px] transition-colors ${
                type === value
                  ? "bg-[var(--bg-hover)] text-[var(--text)]"
                  : "bg-[var(--bg-raised)] text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {options.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setAmount(value)}
              className={`rounded border px-2.5 py-1 text-[11px] transition-colors ${
                amount === value
                  ? "border-[var(--accent)] bg-[var(--bg-hover)] text-[var(--text)]"
                  : "border-[var(--border-strong)] text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              {formatEur(value)}
            </button>
          ))}
        </div>

        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="amountEur" value={amount} />

        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" size="sm" disabled={pending}>
            {pending ? "In the meeting..." : `Ask for ${formatEur(amount)}`}
          </Button>
          <span className="text-[11px] text-[var(--text-dim)]">
            They will not take the meeting more than twice a season
          </span>
        </div>

        {state?.error && (
          <p className="rounded border border-[var(--bad)] bg-[rgba(248,81,73,0.08)] px-2.5 py-1.5 text-[11px] text-[var(--bad)]">
            {state.error}
          </p>
        )}
        {state?.message && (
          <p className="rounded border border-[var(--good)] bg-[rgba(63,185,80,0.08)] px-2.5 py-1.5 text-[11px] text-[var(--good)]">
            {state.message}
          </p>
        )}
      </form>
    </Panel>
  );
}
