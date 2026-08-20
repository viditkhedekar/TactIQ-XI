"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setIndividualFocusAction } from "@/app/actions";
import { TRAINING_FOCUS_LABELS, type TrainingFocus } from "@/engine";

/**
 * Puts one player on his own programme.
 *
 * A select rather than a modal: the manager is scanning a squad list and
 * wants to change one man's work without leaving the row he is looking at.
 */
export function IndividualFocusPicker({
  playerId,
  current,
}: {
  playerId: number;
  current: TrainingFocus | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function change(value: string) {
    startTransition(async () => {
      await setIndividualFocusAction(playerId, value === "" ? null : value);
      router.refresh();
    });
  }

  return (
    <select
      value={current ?? ""}
      disabled={pending}
      onChange={(e) => change(e.target.value)}
      aria-label="Individual training focus"
      className={`w-full rounded border bg-[var(--bg)] px-1.5 py-0.5 text-[11px] transition-colors disabled:opacity-50 ${
        current
          ? "border-[var(--accent)] text-[var(--accent)]"
          : "border-[var(--border)] text-[var(--text-dim)]"
      }`}
    >
      <option value="">Squad plan</option>
      {(Object.keys(TRAINING_FOCUS_LABELS) as TrainingFocus[]).map((focus) => (
        <option key={focus} value={focus}>
          {TRAINING_FOCUS_LABELS[focus]}
        </option>
      ))}
    </select>
  );
}
