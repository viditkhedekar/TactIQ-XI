"use client";

import { useMemo, useState, useTransition } from "react";
import { saveTacticsAction } from "@/app/actions";
import { FORMATION_NAMES, type FormationName, type Slot } from "@/engine";
import { Attr, AvailabilityIcon, Button, FitnessBar, Panel } from "@/components/ui/primitives";
import { FORMATION_LAYOUT, SLOT_LABEL } from "./formationLayout";

export type TacticsPlayer = {
  id: number;
  name: string;
  positions: string;
  isGk: boolean;
  overall: number;
  fitness: number;
  form: number | null;
  unavailable: "injured" | "suspended" | null;
  fits: Record<Slot, number>;
};

type Instructions = {
  mentality: number;
  pressing: number;
  tempo: number;
  width: number;
  directness: number;
};

export type TacticsState = Instructions & {
  formation: FormationName;
  lineup: { playerId: number; slot: Slot }[];
  bench: number[];
};

const SLIDERS: {
  key: keyof Instructions;
  label: string;
  labels: [string, string, string, string, string];
}[] = [
  {
    key: "mentality",
    label: "Mentality",
    labels: ["Very defensive", "Defensive", "Balanced", "Positive", "Attacking"],
  },
  {
    key: "pressing",
    label: "Pressing",
    labels: ["Stand off", "Low", "Medium", "High", "Relentless"],
  },
  { key: "tempo", label: "Tempo", labels: ["Very slow", "Slow", "Standard", "Fast", "Very fast"] },
  { key: "width", label: "Width", labels: ["Very narrow", "Narrow", "Standard", "Wide", "Very wide"] },
  {
    key: "directness",
    label: "Passing",
    labels: ["Short", "Patient", "Mixed", "Direct", "Long ball"],
  },
];

/** Colour for how well a player suits the slot they are in. */
function fitColor(fit: number): string {
  if (fit >= 0.99) return "var(--good)";
  if (fit >= 0.85) return "var(--ok)";
  return "var(--bad)";
}

export function TacticsBoard({
  players,
  initial,
}: {
  players: TacticsPlayer[];
  initial: TacticsState;
}) {
  const [state, setState] = useState<TacticsState>(initial);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const layout = FORMATION_LAYOUT[state.formation];
  const assigned = useMemo(
    () => new Map(state.lineup.map((e) => [e.slot, e.playerId])),
    [state.lineup],
  );
  const usedIds = useMemo(
    () => new Set([...state.lineup.map((e) => e.playerId), ...state.bench]),
    [state.lineup, state.bench],
  );

  /** Changing shape keeps whoever still has a slot and drops the rest. */
  function changeFormation(formation: FormationName) {
    const slots = FORMATION_LAYOUT[formation].map((s) => s.slot);
    const kept = state.lineup.filter((e) => slots.includes(e.slot));
    setState((prev) => ({ ...prev, formation, lineup: kept }));
    setSelectedSlot(null);
    setMessage(null);
  }

  /**
   * Assigning a player to a slot. If they were already in the side, the two
   * swap places rather than the player appearing twice.
   */
  function assign(slot: Slot, playerId: number) {
    setState((prev) => {
      const existingHere = prev.lineup.find((e) => e.slot === slot);
      const existingElsewhere = prev.lineup.find((e) => e.playerId === playerId);

      let lineup = prev.lineup.filter((e) => e.slot !== slot && e.playerId !== playerId);

      if (existingElsewhere && existingHere) {
        lineup = [...lineup, { slot: existingElsewhere.slot, playerId: existingHere.playerId }];
      }

      return {
        ...prev,
        lineup: [...lineup, { slot, playerId }],
        bench: prev.bench.filter((id) => id !== playerId),
      };
    });
    setSelectedSlot(null);
    setMessage(null);
  }

  function clearSlot(slot: Slot) {
    setState((prev) => ({ ...prev, lineup: prev.lineup.filter((e) => e.slot !== slot) }));
    setMessage(null);
  }

  function toggleBench(playerId: number) {
    setState((prev) => {
      if (prev.bench.includes(playerId)) {
        return { ...prev, bench: prev.bench.filter((id) => id !== playerId) };
      }
      if (prev.bench.length >= 9) return prev;
      return {
        ...prev,
        bench: [...prev.bench, playerId],
        lineup: prev.lineup.filter((e) => e.playerId !== playerId),
      };
    });
    setMessage(null);
  }

  function save() {
    setMessage(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("payload", JSON.stringify(state));
      const result = await saveTacticsAction(null, formData);
      setMessage(
        result?.error
          ? { text: result.error, ok: false }
          : { text: "Team sheet saved", ok: true },
      );
    });
  }

  const emptySlots = layout.length - state.lineup.length;

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-3">
        <Panel
          title="Shape"
          action={
            <select
              value={state.formation}
              onChange={(e) => changeFormation(e.target.value as FormationName)}
              className="rounded border border-[var(--border-strong)] bg-[var(--bg)] px-2 py-1 text-[12px] outline-none focus:border-[var(--accent)]"
            >
              {FORMATION_NAMES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          }
        >
          <div
            className="relative mx-auto my-3 w-full max-w-[340px] overflow-hidden rounded"
            style={{
              aspectRatio: "68 / 105",
              background: "var(--pitch)",
              backgroundImage:
                "repeating-linear-gradient(0deg, rgba(255,255,255,0.022) 0 8.5%, transparent 8.5% 17%)",
            }}
          >
            <PitchMarkings />

            {layout.map(({ slot, x, y }) => {
              const playerId = assigned.get(slot);
              const player = playerId ? byId.get(playerId) : undefined;
              const isSelected = selectedSlot === slot;

              return (
                <button
                  key={slot}
                  type="button"
                  onClick={() => setSelectedSlot(isSelected ? null : slot)}
                  className={`absolute flex w-[68px] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5 rounded px-1 py-1 transition-colors ${
                    isSelected ? "ring-2 ring-[var(--accent)]" : ""
                  }`}
                  style={{
                    left: `${x}%`,
                    top: `${y}%`,
                    background: player ? "rgba(13,17,23,0.88)" : "rgba(13,17,23,0.55)",
                  }}
                >
                  <span className="text-[9px] font-bold uppercase tracking-wide text-[var(--text-dim)]">
                    {SLOT_LABEL[slot]}
                  </span>
                  {player ? (
                    <>
                      <span className="w-full truncate text-[10px] font-medium leading-tight">
                        {player.name}
                      </span>
                      <span className="flex items-center gap-1">
                        <span
                          className="numeric text-[10px] font-semibold"
                          style={{ color: fitColor(player.fits[slot]) }}
                        >
                          {player.overall}
                        </span>
                        {player.unavailable && <AvailabilityIcon reason={player.unavailable} />}
                      </span>
                    </>
                  ) : (
                    <span className="text-[10px] text-[var(--text-dim)]">Empty</span>
                  )}
                </button>
              );
            })}
          </div>

          {selectedSlot && (
            <div className="border-t border-[var(--border)] px-3 py-2">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                  Choose a player for {SLOT_LABEL[selectedSlot]}
                </span>
                {assigned.has(selectedSlot) && (
                  <Button size="sm" variant="ghost" onClick={() => clearSlot(selectedSlot)}>
                    Clear slot
                  </Button>
                )}
              </div>
              <SlotPicker
                slot={selectedSlot}
                players={players}
                onPick={(id) => assign(selectedSlot, id)}
              />
            </div>
          )}
        </Panel>

        <Panel title="Instructions">
          <div className="grid gap-x-6 gap-y-3 p-3 sm:grid-cols-2">
            {SLIDERS.map((slider) => (
              <div key={slider.key}>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-[var(--text-muted)]">{slider.label}</span>
                  <span className="text-[11px] font-medium">
                    {slider.labels[state[slider.key] - 1]}
                  </span>
                </div>
                <div className="flex gap-px overflow-hidden rounded border border-[var(--border-strong)]">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      title={slider.labels[value - 1]}
                      onClick={() => {
                        setState((prev) => ({ ...prev, [slider.key]: value }));
                        setMessage(null);
                      }}
                      className={`h-6 flex-1 text-[10px] transition-colors ${
                        state[slider.key] === value
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
        </Panel>
      </div>

      <div className="space-y-3">
        <Panel
          title="Substitutes"
          action={
            <span className="text-[11px] text-[var(--text-dim)]">{state.bench.length} of 9</span>
          }
        >
          <ul className="max-h-[220px] overflow-y-auto">
            {state.bench.length === 0 && (
              <li className="px-3 py-3 text-[var(--text-muted)]">
                Pick substitutes from the squad list below.
              </li>
            )}
            {state.bench.map((id) => {
              const player = byId.get(id);
              if (!player) return null;
              return (
                <li
                  key={id}
                  className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-1 last:border-0"
                >
                  <span className="min-w-0 flex-1 truncate">{player.name}</span>
                  <span className="text-[11px] text-[var(--text-dim)]">{player.positions}</span>
                  <Attr value={player.overall} />
                  <Button size="sm" variant="ghost" onClick={() => toggleBench(id)}>
                    Remove
                  </Button>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel title="Squad">
          <ul className="max-h-[420px] overflow-y-auto">
            {players.map((player) => {
              const inUse = usedIds.has(player.id);
              return (
                <li
                  key={player.id}
                  className={`flex items-center gap-2 border-b border-[var(--border)] px-3 py-1 last:border-0 ${
                    inUse ? "opacity-45" : "hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="truncate">{player.name}</span>
                    <AvailabilityIcon reason={player.unavailable} />
                  </span>
                  <span className="w-20 shrink-0 truncate text-[11px] text-[var(--text-dim)]">
                    {player.positions}
                  </span>
                  <Attr value={player.overall} />
                  <span className="w-16 shrink-0">
                    <FitnessBar value={player.fitness} />
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={inUse || player.unavailable !== null}
                    onClick={() => toggleBench(player.id)}
                  >
                    Bench
                  </Button>
                </li>
              );
            })}
          </ul>
        </Panel>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={save} disabled={pending || emptySlots > 0}>
            {pending ? "Saving..." : "Save team sheet"}
          </Button>
          {emptySlots > 0 && (
            <span className="text-[11px] text-[var(--ok)]">
              {emptySlots} {emptySlots === 1 ? "position" : "positions"} still empty
            </span>
          )}
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
    </div>
  );
}

/** Squad list ordered by how well each player suits the chosen slot. */
function SlotPicker({
  slot,
  players,
  onPick,
}: {
  slot: Slot;
  players: TacticsPlayer[];
  onPick: (playerId: number) => void;
}) {
  const ranked = useMemo(
    () =>
      [...players]
        .filter((p) => p.unavailable === null)
        .sort((a, b) => b.overall * b.fits[slot] - a.overall * a.fits[slot]),
    [players, slot],
  );

  return (
    <ul className="max-h-52 overflow-y-auto rounded border border-[var(--border)]">
      {ranked.map((player) => (
        <li key={player.id}>
          <button
            type="button"
            onClick={() => onPick(player.id)}
            className="flex w-full items-center gap-2 border-b border-[var(--border)] px-2 py-1 text-left last:border-0 hover:bg-[var(--bg-hover)]"
          >
            <span className="min-w-0 flex-1 truncate">{player.name}</span>
            <span className="w-20 shrink-0 truncate text-[11px] text-[var(--text-dim)]">
              {player.positions}
            </span>
            <Attr value={player.overall} />
            <span
              className="numeric w-9 shrink-0 text-right text-[11px]"
              style={{ color: fitColor(player.fits[slot]) }}
              title="How well this player suits the position"
            >
              {Math.round(player.fits[slot] * 100)}%
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Halfway line, centre circle and both penalty areas. */
function PitchMarkings() {
  const line = "var(--pitch-line)";
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 68 105"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <g fill="none" stroke={line} strokeWidth="0.4">
        <rect x="1" y="1" width="66" height="103" />
        <line x1="1" y1="52.5" x2="67" y2="52.5" />
        <circle cx="34" cy="52.5" r="9.15" />
        <rect x="13.85" y="1" width="40.3" height="16.5" />
        <rect x="24.85" y="1" width="18.3" height="5.5" />
        <rect x="13.85" y="87.5" width="40.3" height="16.5" />
        <rect x="24.85" y="98.5" width="18.3" height="5.5" />
      </g>
    </svg>
  );
}
