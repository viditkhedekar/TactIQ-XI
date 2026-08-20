"use client";

/**
 * Changes made during the match, at the minute the manager paused on.
 *
 * That minute travels with the request so the server rewinds to exactly what
 * they were watching before applying anything, which is what stops a change
 * rewriting commentary they have already read.
 *
 * Everything the tactics screen offers is offered here too, using the same
 * components: half time is precisely when a manager wants to drop the line,
 * stop stepping up, move to a back three or put someone else on penalties, and
 * a drawer with only five sliders in it would send them back to the team sheet
 * they cannot reach.
 */

import { useMemo, useState } from "react";
import { useMatchStore, type SideSummary } from "@/store/matchStore";
import { Button } from "@/components/ui/primitives";
import {
  applyStyle,
  normaliseTactics,
  type PitchPlacement,
  type Slot,
  type TacticalStyleName,
  type TeamTactics,
} from "@/engine";
import { PitchBoard, type BoardPlayer } from "@/components/tactics/PitchBoard";
import {
  InstructionChoices,
  InstructionSliders,
  SetPiecePanel,
  StylePicker,
} from "@/components/tactics/InstructionPanels";

type Tab = "subs" | "shape" | "instructions" | "setpieces";

const TABS: { key: Tab; label: string }[] = [
  { key: "subs", label: "Subs" },
  { key: "shape", label: "Shape" },
  { key: "instructions", label: "Instructions" },
  { key: "setpieces", label: "Set pieces" },
];

/** A neutral fit table: the drawer has no rating model, and does not need one. */
const NEUTRAL_FITS = {} as Record<Slot, number>;

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
  const [tab, setTab] = useState<Tab>("subs");
  const [tactics, setTactics] = useState<TeamTactics>(side.tactics);
  const [placements, setPlacements] = useState<PitchPlacement[]>(side.placements ?? []);
  const [subs, setSubs] = useState<{ off: number; on: number }[]>([]);
  const [pendingOff, setPendingOff] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subsRemaining = 5 - subs.length;
  const offIds = new Set(subs.map((s) => s.off));

  const boardPlayers = useMemo(() => {
    const map = new Map<number, BoardPlayer>();
    for (const p of side.onPitch) {
      map.set(p.id, {
        id: p.id,
        name: p.name,
        isGk: p.isGk,
        overall: 0,
        fitness: p.fitness,
        unavailable: null,
        fits: NEUTRAL_FITS,
      });
    }
    return map;
  }, [side.onPitch]);

  const squadForTakers = useMemo(
    () => [...side.onPitch, ...side.bench].map((p) => ({ id: p.id, name: p.name })),
    [side.onPitch, side.bench],
  );

  // Only what actually moved is sent, so the server can tell a real change from
  // a drawer that was opened and closed again.
  const changedTactics = useMemo(() => {
    const out: Partial<TeamTactics> = {};
    for (const key of Object.keys(tactics) as (keyof TeamTactics)[]) {
      if (JSON.stringify(tactics[key]) !== JSON.stringify(side.tactics[key])) {
        (out as Record<string, unknown>)[key] = tactics[key];
      }
    }
    return out;
  }, [tactics, side.tactics]);

  const shapeChanged =
    JSON.stringify(placements) !== JSON.stringify(side.placements ?? []);
  const hasChanges =
    subs.length > 0 || Object.keys(changedTactics).length > 0 || shapeChanged;

  function patch(change: Partial<TeamTactics>) {
    setTactics((prev) => normaliseTactics({ ...prev, ...change }));
    setError(null);
  }

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
        body: JSON.stringify({
          atMinute,
          tactics: changedTactics,
          placements: shapeChanged ? placements : undefined,
          subs,
        }),
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
      if (shapeChanged) store.applyLocalPlacements(placements);

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
        className="flex h-full w-full max-w-md flex-col border-l border-[var(--border-strong)] bg-[var(--bg-raised)]"
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

        <nav className="flex border-b border-[var(--border)]">
          {TABS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => setTab(entry.key)}
              aria-current={tab === entry.key ? "page" : undefined}
              className={`flex-1 border-b-2 px-2 py-2 text-[11px] transition-colors ${
                tab === entry.key
                  ? "border-[var(--accent)] text-[var(--text)]"
                  : "border-transparent text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              {entry.label}
            </button>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "subs" && (
            <section className="p-4">
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
                {pendingOff === null ? "Choose a player to take off" : "Now choose who comes on"}
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
                        <span className="numeric shrink-0 text-[10px] text-[var(--text-dim)]">
                          {player.fitness}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="grid grid-cols-2 gap-1">
                  {side.bench.map((player) => (
                    <li key={player.id}>
                      <button
                        type="button"
                        onClick={() => pickOn(player.id)}
                        className="flex w-full items-center gap-1.5 rounded border border-[var(--border)] px-2 py-1 text-left transition-colors hover:bg-[var(--bg-hover)]"
                      >
                        <span className="min-w-0 flex-1 truncate">{player.name}</span>
                        <span className="numeric shrink-0 text-[10px] text-[var(--text-dim)]">
                          {player.fitness}
                        </span>
                      </button>
                    </li>
                  ))}
                  <li className="col-span-2">
                    <button
                      type="button"
                      onClick={() => setPendingOff(null)}
                      className="w-full rounded px-2 py-1 text-[11px] text-[var(--text-dim)] hover:text-[var(--text)]"
                    >
                      Cancel
                    </button>
                  </li>
                </ul>
              )}
            </section>
          )}

          {tab === "shape" && (
            <section className="p-4">
              <PitchBoard
                placements={placements}
                players={boardPlayers}
                captainId={tactics.captainId}
                selectedId={null}
                onSelect={() => {}}
                onChange={(next) => {
                  setPlacements(next);
                  setError(null);
                }}
                compact
              />
              <p className="mt-2 text-[11px] text-[var(--text-dim)]">
                Move players to change shape without using a substitution. Going to a back three
                at half time is a shape change, not a swap.
              </p>
            </section>
          )}

          {tab === "instructions" && (
            <section>
              <StylePicker
                tactics={tactics}
                compact
                onApply={(style: TacticalStyleName) =>
                  setTactics((prev) => applyStyle(prev, style))
                }
              />
              <div className="border-t border-[var(--border)]">
                <InstructionSliders tactics={tactics} onChange={patch} />
              </div>
              <div className="border-t border-[var(--border)]">
                <InstructionChoices tactics={tactics} onChange={patch} />
              </div>
            </section>
          )}

          {tab === "setpieces" && (
            <section>
              <div className="p-3">
                <label
                  htmlFor="drawer-captain"
                  className="block text-[11px] text-[var(--text-muted)]"
                >
                  Captain
                </label>
                <select
                  id="drawer-captain"
                  value={tactics.captainId ?? ""}
                  onChange={(e) =>
                    patch({ captainId: e.target.value ? Number(e.target.value) : null })
                  }
                  className="mt-0.5 w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[12px] outline-none focus:border-[var(--accent)]"
                >
                  <option value="">Nobody</option>
                  {squadForTakers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="border-t border-[var(--border)]">
                <SetPiecePanel tactics={tactics} squad={squadForTakers} onChange={patch} />
              </div>
            </section>
          )}
        </div>

        <footer className="border-t border-[var(--border)] p-4">
          {error && <p className="mb-2 text-[11px] text-[var(--bad)]">{error}</p>}
          <div className="flex items-center gap-2">
            <Button variant="primary" onClick={apply} disabled={busy || !hasChanges}>
              {busy ? "Applying..." : "Apply changes"}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
