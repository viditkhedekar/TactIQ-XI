"use client";

import { useState, useTransition } from "react";
import { startNextSeasonAction } from "@/app/actions";
import { Button } from "@/components/ui/primitives";

/**
 * Rolls the save into the next season.
 *
 * Slow enough to need its own busy state: it ages every player in the game,
 * writes a full season of history and redraws the fixture list.
 */
export function StartNextSeasonButton({ relegated }: { relegated: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <Button
        variant="primary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await startNextSeasonAction();
            if (result?.error) setError(result.error);
          })
        }
      >
        {pending
          ? "Turning the page..."
          : relegated
            ? "Face the board"
            : "Start next season"}
      </Button>
      {error && <p className="text-[11px] text-[var(--bad)]">{error}</p>}
    </div>
  );
}
