"use client";

import { useState, useTransition } from "react";
import { requestSaleAction } from "@/app/actions";
import { Button, Panel } from "@/components/ui/primitives";

/**
 * Asking the board to move a player on.
 *
 * A plain select rather than a list of buttons: this is a rare action taken
 * about one specific player, and a squad-length list of buttons would dominate
 * a column that is mostly about money.
 */
export function SellRequestPicker({
  players,
}: {
  players: { id: number; name: string; overall: number }[];
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (selected === null) return;
    startTransition(async () => {
      const result = await requestSaleAction(selected);
      setMessage(
        result?.error
          ? { text: result.error, ok: false }
          : { text: result?.message ?? "Done", ok: true },
      );
    });
  }

  return (
    <Panel title="Move a player on">
      <div className="space-y-3 p-3">
        <select
          value={selected ?? ""}
          onChange={(e) => {
            setSelected(e.target.value ? Number(e.target.value) : null);
            setMessage(null);
          }}
          className="w-full rounded border border-[var(--border-strong)] bg-[var(--bg)] px-2 py-1.5 text-[12px] outline-none focus:border-[var(--accent)]"
        >
          <option value="">Pick a player</option>
          {[...players]
            .sort((a, b) => b.overall - a.overall)
            .map((player) => (
              <option key={player.id} value={player.id}>
                {player.name} ({player.overall})
              </option>
            ))}
        </select>

        <Button
          type="button"
          size="sm"
          onClick={submit}
          disabled={selected === null || pending}
        >
          {pending ? "Asking..." : "Ask them to list him"}
        </Button>

        {message && (
          <p
            className="rounded border px-2.5 py-1.5 text-[11px]"
            style={{
              borderColor: message.ok ? "var(--good)" : "var(--bad)",
              color: message.ok ? "var(--good)" : "var(--bad)",
              background: message.ok ? "rgba(63,185,80,0.08)" : "rgba(248,81,73,0.08)",
            }}
          >
            {message.text}
          </p>
        )}
      </div>
    </Panel>
  );
}
