"use client";

import { useActionState, useState } from "react";
import { startCareerAction, type ActionState } from "@/app/actions";
import { Button, ClubDot, Panel } from "./ui/primitives";

export type ClubOption = {
  id: number;
  name: string;
  shortName: string;
  primaryColor: string;
  secondaryColor: string;
  squadSize: number;
  strength: number;
};

/**
 * Squad strength as a five-star rating.
 *
 * The Premier League's best sixteen players average between about 74 and 86 in
 * this data, so the scale is stretched across that band. Normalising over the
 * full 1 to 100 range would leave every club showing four stars.
 */
function Stars({ strength }: { strength: number }) {
  const normalized = Math.max(0, Math.min(1, (strength - 73) / 12));
  const filled = Math.max(1, Math.round(normalized * 5));

  return (
    <span className="flex gap-[1px]" title={`Squad rating ${strength}`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className="text-[10px] leading-none"
          style={{ color: i <= filled ? "var(--ok)" : "var(--border-strong)" }}
        >
          {i <= filled ? "★" : "☆"}
        </span>
      ))}
    </span>
  );
}

export function StartCareerForm({ clubs }: { clubs: ClubOption[] }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    startCareerAction,
    null,
  );
  const [selected, setSelected] = useState<number | null>(null);

  return (
    <form action={formAction} className="space-y-5">
      <Panel title="Manager">
        <div className="p-3">
          <label htmlFor="username" className="mb-1.5 block text-[var(--text-muted)]">
            Your name
          </label>
          <input
            id="username"
            name="username"
            autoComplete="off"
            autoFocus
            spellCheck={false}
            placeholder="e.g. vidit"
            className="w-full max-w-xs rounded border border-[var(--border-strong)] bg-[var(--bg)] px-2.5 py-1.5 text-[13px] outline-none placeholder:text-[var(--text-dim)] focus:border-[var(--accent)]"
          />
          <p className="mt-1.5 text-[11px] text-[var(--text-dim)]">
            3 to 20 characters. Letters, numbers, hyphens and underscores. Enter a name you
            have used before to pick that career back up.
          </p>
        </div>
      </Panel>

      <Panel title="Club" action={<span className="text-[11px] text-[var(--text-dim)]">New careers only</span>}>
        <div className="grid grid-cols-2 gap-px bg-[var(--border)] sm:grid-cols-3 lg:grid-cols-4">
          {clubs.map((club) => {
            const isSelected = selected === club.id;
            return (
              <button
                key={club.id}
                type="button"
                onClick={() => setSelected(isSelected ? null : club.id)}
                aria-pressed={isSelected}
                className={`flex flex-col gap-1.5 bg-[var(--bg-raised)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--bg-hover)] ${
                  isSelected ? "ring-1 ring-inset ring-[var(--accent)]" : ""
                }`}
                style={isSelected ? { background: "var(--bg-hover)" } : undefined}
              >
                <span className="flex items-center gap-2">
                  <ClubDot color={club.primaryColor} />
                  <span className="truncate font-medium">{club.name}</span>
                </span>
                <span className="flex items-center justify-between">
                  <Stars strength={club.strength} />
                  <span className="numeric text-[11px] text-[var(--text-dim)]">
                    {club.squadSize} players
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Panel>

      {selected !== null && <input type="hidden" name="clubId" value={selected} />}

      {state?.error && (
        <p className="rounded border border-[var(--bad)] bg-[rgba(248,81,73,0.08)] px-3 py-2 text-[var(--bad)]">
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Starting..." : selected === null ? "Resume career" : "Start career"}
        </Button>
        <span className="text-[11px] text-[var(--text-dim)]">
          {selected === null
            ? "Choose a club above to begin a new save"
            : `Taking charge of ${clubs.find((c) => c.id === selected)?.name}`}
        </span>
      </div>
    </form>
  );
}
