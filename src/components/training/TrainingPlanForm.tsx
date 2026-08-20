"use client";

import { useActionState, useState } from "react";
import { saveTrainingAction } from "@/app/actions";
import { Button } from "@/components/ui/primitives";
import { TRAINING_FOCUS_LABELS, type TrainingFocus } from "@/engine";

/** What each focus is for, in the manager's language rather than the engine's. */
const FOCUS_BLURB: Record<TrainingFocus, string> = {
  balanced: "A bit of everything. Nobody improves quickly, nobody is neglected.",
  finishing: "Shooting and composure in front of goal. For forwards who are missing.",
  creativity: "Vision and passing range. For a midfield that is not making chances.",
  wing_play: "Crossing, dribbling and pace out wide.",
  defending: "Tackling, marking and reading the game.",
  aerial: "Heading and jumping, at both ends of the pitch.",
  fitness: "Stamina and strength. Pays off in the last twenty minutes.",
  possession: "Short passing and control, for keeping the ball.",
  pressing: "Winning it back high, and the legs to keep doing it.",
  set_pieces: "Free kicks, corners and penalties.",
  discipline: "Composure, and taking the recklessness out of a squad that keeps getting booked.",
  goalkeeping: "Reflexes, handling and positioning. Only your keepers benefit.",
};

const INTENSITY_LABELS = [
  { value: 1, label: "Rest", note: "No work, full recovery, no risk." },
  { value: 2, label: "Light", note: "Gentle. Slight cost to freshness." },
  { value: 3, label: "Normal", note: "The usual week." },
  { value: 4, label: "Hard", note: "Faster progress, tired legs, some risk." },
  { value: 5, label: "Punishing", note: "Fastest progress. They will be tired and they will break." },
];

export function TrainingPlanForm({
  initialFocus,
  initialIntensity,
}: {
  initialFocus: TrainingFocus;
  initialIntensity: number;
}) {
  const [state, action, pending] = useActionState(saveTrainingAction, null);
  const [focus, setFocus] = useState<TrainingFocus>(initialFocus);
  const [intensity, setIntensity] = useState(initialIntensity);

  const dirty = focus !== initialFocus || intensity !== initialIntensity;

  return (
    <form action={action} className="space-y-4 p-3">
      <input type="hidden" name="focus" value={focus} />
      <input type="hidden" name="intensity" value={intensity} />

      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Squad focus
        </p>
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(TRAINING_FOCUS_LABELS) as TrainingFocus[]).map((option) => {
            const active = focus === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => setFocus(option)}
                aria-pressed={active}
                className={`rounded border px-2.5 py-2 text-left transition-colors ${
                  active
                    ? "border-[var(--accent)] bg-[rgba(47,129,247,0.12)]"
                    : "border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                <span className={`block font-medium ${active ? "text-[var(--accent)]" : ""}`}>
                  {TRAINING_FOCUS_LABELS[option]}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-[var(--text-dim)]">
                  {FOCUS_BLURB[option]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Intensity
        </p>
        <div className="flex flex-wrap gap-1.5">
          {INTENSITY_LABELS.map((option) => {
            const active = intensity === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setIntensity(option.value)}
                aria-pressed={active}
                title={option.note}
                className={`rounded border px-3 py-1.5 text-[12px] transition-colors ${
                  active
                    ? "border-[var(--accent)] bg-[rgba(47,129,247,0.12)] text-[var(--accent)]"
                    : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] text-[var(--text-dim)]">
          {INTENSITY_LABELS.find((o) => o.value === intensity)?.note}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" disabled={pending || !dirty}>
          {pending ? "Saving..." : dirty ? "Save plan" : "Saved"}
        </Button>
        {state?.error && <span className="text-[11px] text-[var(--bad)]">{state.error}</span>}
      </div>
    </form>
  );
}
