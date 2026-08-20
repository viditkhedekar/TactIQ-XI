"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/primitives";
import { setTrainingFocusAction } from "@/app/actions";
import type { TrainingFocus } from "@/engine";

/**
 * Takes the report's advice in one click.
 *
 * The report is only worth reading if acting on it is easy, so the
 * recommendation carries the button that applies it rather than sending the
 * manager off to find the training screen and remember what it said.
 */
export function ApplyTrainingButton({ focus }: { focus: TrainingFocus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [applied, setApplied] = useState(false);

  function apply() {
    startTransition(async () => {
      await setTrainingFocusAction(focus);
      setApplied(true);
      router.refresh();
    });
  }

  if (applied) {
    return <span className="shrink-0 text-[11px] text-[var(--good)]">Set</span>;
  }

  return (
    <Button size="sm" onClick={apply} disabled={pending} className="shrink-0">
      {pending ? "..." : "Train this"}
    </Button>
  );
}
