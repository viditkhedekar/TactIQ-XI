"use client";

import { useState } from "react";
import { useMatchStore, type SideSummary } from "@/store/matchStore";
import { Button } from "@/components/ui/primitives";

const SLIDERS = [
  {
    key: "mentality" as const,
    label: "Mentality",
    labels: ["Very defensive", "Defensive", "Balanced", "Positive", "Attacking"],
  },
  {
    key: "pressing" as const,
    label: "Pressing",
    labels: ["Stand off", "Low", "Medium", "High", "Relentless"],
  },
  {
    key: "tempo" as const,
    label: "Tempo",
    labels: ["Very slow", "Slow", "Standard", "Fast", "Very fast"],
  },
  {
    key: "width" as const,
    label: "Width",
    labels: ["Very narrow", "Narrow", "Standard", "Wide", "Very wide"],
  },
  {
    key: "directness" as const,
    label: "Passing",
    labels: ["Short", "Patient", "Mixed", "Direct", "Long ball"],
  },
];

/**
 * Substitutions and instruction changes, made at the minute the manager
 * paused on. That minute is sent with the request so the server rewinds to
 * exactly what they were watching before applying anything.
 */
export function TacticsDrawer({
  side,
  atMinute,
  onClose,
}: {
  side: SideSummary;
  atMinute: number;
  onClose: () => void;
}) {
  const store = useMatchStore();
  const [tactics, setTactics] = useState(side.tactics);
  const [subs, setSubs] = useState<{ off: number; on: number }[]>([]);
  const [pendingOff, setPendingOff] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subsRemaining = 5 - subs.length;
  const offIds = new Set(subs.map((s) => s.off));
  const onIds = new Set(subs.map((s) => s.on));

  const changedTactics = Object.fromEntries(
    Object.entries(tactics).filter(
      ([key, value]) => value !== side.tactics[key as keyof typeof side.tactics],
    ),
  );
  const hasChanges = subs.length > 0 || Object.keys(changedTactics).length > 0;

  function pickOn(playerId: number) {
    if (pendingOff === null) return;
    setSubs((prev) => [...prev, { off: pendingOff, on: playerId }]);
    setPendingOff(null);
    setError(null);
  }

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/match/intervene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ atMinute, tactics: changedTactics, subs }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not apply those changes");

      if (body.subsApplied < subs.length) {
        setError(
          `Only ${body.subsApplied} of ${subs.length} substitutions were allowed. The rest were rejected.`,
        );
      }

      for (const sub of subs.slice(0, body.subsApplied)) {
        store.applyLocalSub(sub.off, sub.on);
      }
      if (body.tacticsChanged) store.applyLocalTactics(changedTactics);

      store.replaceFrom({ fromMinute: atMinute, ...body });

      if (body.subsApplied === subs.length) onClose();
      else setSubs([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not apply those changes");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-[var(--border-strong)] bg-[var(--bg-raised)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div>
            <h2 className="font-semibold">Changes at {atMinute}&apos;</h2>
            <p className="text-[11px] text-[var(--text-dim)]">{side.clubName}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </header>

        <section className="border-b border-[var(--border)] p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Substitutions
            </h3>
            <span className="text-[11px] text-[var(--text-dim)]">
              {subsRemaining} remaining
            </span>
          </div>

          {subs.length > 0 && (
            <ul className="mb-3 space-y-1">
              {subs.map((sub, index) => {
                const off = side.onPitch.find((p) => p.id === sub.off);
                const on = side.bench.find((p) => p.id === sub.on);
                return (
                  <li
                    key={index}
                    className="flex items-center gap-2 rounded border border-[var(--border)] px-2 py-1"
                  >
                    <span className="text-[var(--bad)]">{off?.name}</span>
                    <span className="text-[var(--text-dim)]">off for</span>
                    <span className="text-[var(--good)]">{on?.name}</span>
                    <button
                      type="button"
                      onClick={() => setSubs((prev) => prev.filter((_, i) => i !== index))}
                      className="ml-auto text-[11px] text-[var(--text-dim)] hover:text-[var(--bad)]"
                    >
                      Undo
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="mb-1.5 text-[11px] text-[var(--text-dim)]">
            {pendingOff === null
              ? "Choose a player to take off"
              : "Now choose who comes on"}
          </p>

          {pendingOff === null ? (
            <ul className="grid grid-cols-2 gap-1">
              {side.onPitch.map((player) => (
                <li key={player.id}>
                  <button
                    type="button"
                    disabled={offIds.has(player.id) || subsRemaining === 0}
                    onClick={() => setPendingOff(player.id)}
                    className="flex w-full items-center gap-1.5 rounded border border-[var(--border)] px-2 py-1 text-left transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-35 disabled:hover:bg-transparent"
                  >
                    <span className="w-6 shrink-0 text-[9px] text-[var(--text-dim)]">
                      {player.slot}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{player.name}</span>
                    <span
                      className="numeric shrink-0 text-[10px]"
                      style={{
                        color:
                          player.fitness >= 75
                            ? "var(--good)"
                            : player.fitness >= 55
                              ? "var(--ok)"
                              : "var(--bad)",
                      }}
                    >
                      {player.fitness}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <>
              <ul className="grid grid-cols-2 gap-1">
                {side.bench.map((player) => {
                  const offPlayer = side.onPitch.find((p) => p.id === pendingOff);
                  // A keeper may only be replaced by a keeper.
                  const mismatched = offPlayer ? offPlayer.isGk !== player.isGk : false;
                  return (
                    <li key={player.id}>
                      <button
                        type="button"
                        disabled={onIds.has(player.id) || mismatched}
                        onClick={() => pickOn(player.id)}
                        className="flex w-full items-center gap-1.5 rounded border border-[var(--border)] px-2 py-1 text-left transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-35 disabled:hover:bg-transparent"
                        title={mismatched ? "A goalkeeper can only replace a goalkeeper" : undefined}
                      >
                        <span className="min-w-0 flex-1 truncate">{player.name}</span>
                        {player.isGk && (
                          <span className="text-[9px] text-[var(--text-dim)]">GK</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                onClick={() => setPendingOff(null)}
                className="mt-1.5 text-[11px] text-[var(--text-dim)] hover:text-[var(--text)]"
              >
                Cancel this substitution
              </button>
            </>
          )}
        </section>

        <section className="p-4">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Instructions
          </h3>
          <div className="space-y-3">
            {SLIDERS.map((slider) => (
              <div key={slider.key}>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-[var(--text-muted)]">{slider.label}</span>
                  <span className="text-[11px] font-medium">
                    {slider.labels[tactics[slider.key] - 1]}
                  </span>
                </div>
                <div className="flex gap-px overflow-hidden rounded border border-[var(--border-strong)]">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setTactics((prev) => ({ ...prev, [slider.key]: value }))}
                      className={`h-6 flex-1 text-[10px] transition-colors ${
                        tactics[slider.key] === value
                          ? "bg-[var(--accent-dim)] text-white"
                          : "bg-[var(--bg)] text-[var(--text-dim)] hover:bg-[var(--bg-hover)]"
                      }`}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <footer className="mt-auto space-y-2 border-t border-[var(--border)] p-4">
          {error && <p className="text-[11px] text-[var(--bad)]">{error}</p>}
          <div className="flex items-center gap-2">
            <Button variant="primary" onClick={apply} disabled={busy || !hasChanges}>
              {busy ? "Applying..." : "Apply and resume"}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
          <p className="text-[11px] text-[var(--text-dim)]">
            The match rewinds to {atMinute}&apos; and plays on from there with your changes.
          </p>
        </footer>
      </div>
    </div>
  );
}
