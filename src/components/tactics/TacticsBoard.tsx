"use client";

/**
 * The tactics screen.
 *
 * The shape is not chosen, it is arranged: the manager drags the eleven around a
 * pitch and the formation is read back out of where they end up. Everything else
 * hangs off that board, and every control here also appears in the mid-match
 * drawer, because a plan you cannot change at half time is only half a plan.
 */

import { useMemo, useState, useTransition } from "react";
import { saveTacticsAction } from "@/app/actions";
import {
  normaliseTactics,
  type PitchPlacement,
  type Slot,
  type TacticalStyleName,
  type TeamTactics,
} from "@/engine";
import { applyStyle } from "@/engine";
import { Attr, AvailabilityIcon, Button, FitnessBar, Panel } from "@/components/ui/primitives";
import { PitchBoard, type BoardPlayer } from "./PitchBoard";
import {
  InstructionChoices,
  InstructionSliders,
  SetPiecePanel,
  StylePicker,
} from "./InstructionPanels";
import { SLOT_LABEL } from "./formationLayout";

export type TacticsPlayer = BoardPlayer & {
  positions: string;
  form: number | null;
};

export function TacticsBoard({
  players,
  initialTactics,
  initialLineup,
  initialBench,
}: {
  players: TacticsPlayer[];
  initialTactics: TeamTactics;
  initialLineup: PitchPlacement[];
  initialBench: number[];
}) {
  const [tactics, setTactics] = useState<TeamTactics>(initialTactics);
  const [lineup, setLineup] = useState<PitchPlacement[]>(initialLineup);
  const [bench, setBench] = useState<number[]>(initialBench);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const starterIds = useMemo(() => new Set(lineup.map((e) => e.playerId)), [lineup]);

  function patch(change: Partial<TeamTactics>) {
    setTactics((prev) => normaliseTactics({ ...prev, ...change }));
    setMessage(null);
  }

  /**
   * Puts a player into the side. If someone is selected on the pitch the two
   * change places; otherwise he takes the spot of whoever is currently weakest
   * there, which is almost never what is wanted, so the selection route is the
   * one the interface pushes.
   */
  function bringIn(playerId: number) {
    if (selectedId === null) {
      setMessage({ text: "Pick a player on the pitch first, then choose his replacement", ok: false });
      return;
    }

    const target = lineup.find((e) => e.playerId === selectedId);
    if (!target) return;

    const wasStarter = lineup.find((e) => e.playerId === playerId);

    setLineup((prev) =>
      prev.map((entry) => {
        if (entry.playerId === selectedId) return { ...entry, playerId };
        // A straight swap when the incoming player was already in the side.
        if (wasStarter && entry.playerId === playerId) {
          return { ...entry, playerId: selectedId };
        }
        return entry;
      }),
    );

    // Coming off the pitch means going to the bench, and vice versa.
    if (!wasStarter) {
      setBench((prev) => [...prev.filter((id) => id !== playerId), selectedId].slice(0, 9));
    }

    setSelectedId(null);
    setMessage(null);
  }

  function toggleBench(playerId: number) {
    if (starterIds.has(playerId)) return;
    setBench((prev) =>
      prev.includes(playerId)
        ? prev.filter((id) => id !== playerId)
        : prev.length >= 9
          ? prev
          : [...prev, playerId],
    );
    setMessage(null);
  }

  function save() {
    setMessage(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("payload", JSON.stringify({ ...tactics, lineup, bench }));
      const result = await saveTacticsAction(null, formData);
      setMessage(
        result?.error
          ? { text: result.error, ok: false }
          : { text: "Team sheet saved", ok: true },
      );
    });
  }

  const selected = selectedId !== null ? byId.get(selectedId) : null;
  const selectedSlot = lineup.find((e) => e.playerId === selectedId)?.slot ?? null;
  const squadForTakers = useMemo(
    () =>
      players
        .filter((p) => starterIds.has(p.id) || bench.includes(p.id))
        .map((p) => ({ id: p.id, name: p.name })),
    [players, starterIds, bench],
  );

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)_minmax(0,320px)]">
      {/* -------------------------------------------------------- the board */}
      <div className="space-y-3">
        <Panel>
          <div className="p-3">
            <PitchBoard
              placements={lineup}
              players={byId}
              captainId={tactics.captainId}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onChange={(next) => {
                setLineup(next);
                setMessage(null);
              }}
            />
          </div>
        </Panel>

        <Panel title="Captain">
          <div className="p-3">
            <select
              value={tactics.captainId ?? ""}
              onChange={(e) => patch({ captainId: e.target.value ? Number(e.target.value) : null })}
              aria-label="Captain"
              className="w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[12px] outline-none focus:border-[var(--accent)]"
            >
              <option value="">Nobody</option>
              {squadForTakers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[10px] leading-snug text-[var(--text-dim)]">
              A composed captain steadies the side, most of all when you are behind. He does
              nothing from the bench.
            </p>
          </div>
        </Panel>

        <Panel title="Set pieces">
          <SetPiecePanel tactics={tactics} squad={squadForTakers} onChange={patch} />
        </Panel>
      </div>

      {/* -------------------------------------------------------- the squad */}
      <div className="space-y-3">
        <Panel
          title="Squad"
          action={
            selected ? (
              <span className="text-[11px] text-[var(--accent)]">
                {selected.name} at {selectedSlot ? SLOT_LABEL[selectedSlot] : "?"}, pick a
                replacement
              </span>
            ) : (
              <span className="text-[11px] text-[var(--text-dim)]">
                Tap a player on the pitch to swap him
              </span>
            )
          }
        >
          <div className="max-h-[560px] overflow-y-auto">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-[var(--bg-raised)]">
                <tr className="border-b border-[var(--border)] text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
                  <th className="px-3 py-1.5 font-medium">Player</th>
                  <th className="px-1 py-1.5 font-medium">Pos</th>
                  <th className="px-1 py-1.5 text-right font-medium">Ovr</th>
                  <th className="px-2 py-1.5 font-medium">Condition</th>
                  <th className="px-1 py-1.5 text-center font-medium">Fit</th>
                  <th className="px-3 py-1.5 text-right font-medium">Bench</th>
                </tr>
              </thead>
              <tbody>
                {players.map((player) => {
                  const starting = starterIds.has(player.id);
                  const onBench = bench.includes(player.id);
                  // How well he would suit the spot currently selected, which is
                  // the only reason to be looking at this list.
                  const fit = selectedSlot ? player.fits[selectedSlot] : null;

                  return (
                    <tr
                      key={player.id}
                      className={`border-b border-[var(--border)] last:border-0 ${
                        starting ? "bg-[rgba(47,129,247,0.07)]" : ""
                      } ${player.unavailable ? "opacity-50" : ""}`}
                    >
                      <td className="px-3 py-1">
                        <button
                          type="button"
                          disabled={player.unavailable !== null || selectedId === null}
                          onClick={() => bringIn(player.id)}
                          className="flex items-center gap-1.5 text-left disabled:cursor-not-allowed hover:text-[var(--accent)] disabled:hover:text-[var(--text)]"
                        >
                          <span className="truncate">{player.name}</span>
                          {tactics.captainId === player.id && (
                            <span className="text-[9px] font-bold text-[var(--accent)]">C</span>
                          )}
                          <AvailabilityIcon reason={player.unavailable} />
                        </button>
                      </td>
                      <td className="px-1 py-1 text-[10px] text-[var(--text-dim)]">
                        {player.positions}
                      </td>
                      <td className="px-1 py-1 text-right">
                        <Attr value={player.overall} />
                      </td>
                      <td className="px-2 py-1">
                        <FitnessBar value={player.fitness} />
                      </td>
                      <td className="px-1 py-1 text-center">
                        {fit === null ? (
                          <span className="text-[var(--text-dim)]">-</span>
                        ) : (
                          <span
                            className="numeric text-[11px]"
                            style={{
                              color:
                                fit >= 0.99
                                  ? "var(--good)"
                                  : fit >= 0.85
                                    ? "var(--ok)"
                                    : "var(--bad)",
                            }}
                          >
                            {Math.round(fit * 100)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1 text-right">
                        <input
                          type="checkbox"
                          checked={onBench}
                          disabled={starting || player.unavailable !== null}
                          onChange={() => toggleBench(player.id)}
                          aria-label={`${player.name} on the bench`}
                          className="accent-[var(--accent)] disabled:opacity-30"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={save} disabled={pending}>
            {pending ? "Saving..." : "Save team sheet"}
          </Button>
          <span className="text-[11px] text-[var(--text-dim)]">
            {lineup.length} on the pitch, {bench.length} on the bench
          </span>
          {message && (
            <span
              className="text-[11px]"
              style={{ color: message.ok ? "var(--good)" : "var(--bad)" }}
            >
              {message.text}
            </span>
          )}
        </div>
      </div>

      {/* ------------------------------------------------- the instructions */}
      <div className="space-y-3">
        <Panel>
          <StylePicker
            tactics={tactics}
            compact
            onApply={(style: TacticalStyleName) =>
              setTactics((prev) => applyStyle(prev, style))
            }
          />
        </Panel>

        <Panel title="Instructions">
          <InstructionSliders tactics={tactics} onChange={patch} />
        </Panel>

        <Panel title="In and out of possession">
          <InstructionChoices tactics={tactics} onChange={patch} />
        </Panel>
      </div>
    </div>
  );
}

export type { Slot };
