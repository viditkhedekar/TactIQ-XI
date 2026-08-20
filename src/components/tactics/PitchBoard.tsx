"use client";

/**
 * The team sheet as a pitch you can drag people around.
 *
 * There is no formation to pick. The manager drags the eleven wherever he wants
 * them, each drop snaps to the nearest real position, and the shape is read back
 * out of the arrangement. Dropping a player onto a teammate swaps the two, which
 * is what dragging one man onto another almost always means.
 *
 * Pointer events rather than HTML5 drag and drop: the native API cannot show a
 * token following the cursor smoothly, has no useful touch story, and its drop
 * targets are awkward to define over a free surface like this.
 */

import { useCallback, useRef, useState } from "react";
import { PITCH_ANCHORS, anchorAt, describeShape, snapToAnchor } from "@/engine";
import type { PitchPlacement, Slot } from "@/engine";
import { SLOT_LABEL } from "./formationLayout";

export type BoardPlayer = {
  id: number;
  name: string;
  isGk: boolean;
  overall: number;
  fitness: number;
  unavailable: "injured" | "suspended" | null;
  fits: Record<Slot, number>;
};

/** Colour for how well a player suits the position he has been put in. */
function fitColor(fit: number): string {
  if (fit >= 0.99) return "var(--good)";
  if (fit >= 0.85) return "var(--ok)";
  return "var(--bad)";
}

export function PitchBoard({
  placements,
  players,
  captainId,
  selectedId,
  onSelect,
  onChange,
  compact = false,
}: {
  placements: PitchPlacement[];
  players: Map<number, BoardPlayer>;
  captainId: number | null;
  selectedId: number | null;
  onSelect: (playerId: number | null) => void;
  onChange: (placements: PitchPlacement[]) => void;
  compact?: boolean;
}) {
  const pitchRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<{ playerId: number; x: number; y: number } | null>(null);

  /** Cursor position as a percentage of the pitch, clamped to it. */
  const pointToPercent = useCallback((clientX: number, clientY: number) => {
    const box = pitchRef.current?.getBoundingClientRect();
    if (!box) return null;
    return {
      x: Math.max(0, Math.min(100, ((clientX - box.left) / box.width) * 100)),
      y: Math.max(0, Math.min(100, ((clientY - box.top) / box.height) * 100)),
    };
  }, []);

  function startDrag(event: React.PointerEvent, playerId: number) {
    // Left button or touch only, so a right click does not begin a drag that
    // can never be finished.
    if (event.button !== 0) return;
    event.preventDefault();
    (event.target as Element).setPointerCapture?.(event.pointerId);

    const point = pointToPercent(event.clientX, event.clientY);
    if (point) setDragging({ playerId, ...point });
  }

  function onMove(event: React.PointerEvent) {
    if (!dragging) return;
    const point = pointToPercent(event.clientX, event.clientY);
    if (point) setDragging({ ...dragging, ...point });
  }

  function endDrag(event: React.PointerEvent) {
    if (!dragging) return;

    const point = pointToPercent(event.clientX, event.clientY);
    setDragging(null);
    if (!point) return;

    const target = snapToAnchor(point);
    const moving = placements.find((p) => p.playerId === dragging.playerId);
    if (!moving) return;

    // Landing where you started is a click, not a drag: select the player so a
    // squad-list swap can follow.
    if (Math.abs(target.x - moving.x) < 0.5 && Math.abs(target.y - moving.y) < 0.5) {
      onSelect(selectedId === dragging.playerId ? null : dragging.playerId);
      return;
    }

    const occupant = anchorAt(placements, target);

    onChange(
      placements.map((p) => {
        if (p.playerId === dragging.playerId) {
          return { ...p, slot: target.slot, x: target.x, y: target.y };
        }
        // Whoever was standing there takes the vacated spot.
        if (occupant && p.playerId === occupant.playerId) {
          return { ...p, slot: moving.slot, x: moving.x, y: moving.y };
        }
        return p;
      }),
    );
  }

  const shape = describeShape(placements);
  const occupied = new Set(placements.map((p) => `${p.x}:${p.y}`));

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between px-1">
        <span className="text-[11px] uppercase tracking-wider text-[var(--text-dim)]">Shape</span>
        <span className="numeric font-semibold">{shape}</span>
      </div>

      <div
        ref={pitchRef}
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerCancel={() => setDragging(null)}
        className={`relative mx-auto w-full overflow-hidden rounded ${
          compact ? "max-w-[260px]" : "max-w-[380px]"
        } ${dragging ? "cursor-grabbing" : ""}`}
        style={{
          aspectRatio: "68 / 105",
          background: "var(--pitch, #16281c)",
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(255,255,255,0.022) 0 8.5%, transparent 8.5% 17%)",
          touchAction: "none",
        }}
      >
        <PitchMarkings />

        {/* Empty anchors, shown only while dragging so the board is not a mess
            of dots the rest of the time. */}
        {dragging &&
          PITCH_ANCHORS.filter((a) => !occupied.has(`${a.x}:${a.y}`)).map((a) => (
            <span
              key={`${a.slot}-${a.x}-${a.y}`}
              className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-white/25"
              style={{ left: `${a.x}%`, top: `${a.y}%` }}
            />
          ))}

        {placements.map((placement) => {
          const player = players.get(placement.playerId);
          const isDragging = dragging?.playerId === placement.playerId;
          const x = isDragging ? dragging.x : placement.x;
          const y = isDragging ? dragging.y : placement.y;
          const fit = player?.fits[placement.slot] ?? 1;

          return (
            <div
              key={placement.playerId}
              onPointerDown={(e) => startDrag(e, placement.playerId)}
              role="button"
              tabIndex={0}
              aria-label={`${player?.name ?? "Empty"} at ${SLOT_LABEL[placement.slot]}`}
              className={`absolute flex -translate-x-1/2 -translate-y-1/2 cursor-grab select-none flex-col items-center ${
                compact ? "w-[52px]" : "w-[64px]"
              } ${isDragging ? "z-20 opacity-90" : "z-10"} ${
                selectedId === placement.playerId ? "ring-2 ring-[var(--accent)] rounded" : ""
              }`}
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              {/* The marker keeps its dark background whatever the player's
                  availability, so the position stays readable. An unavailable
                  man is flagged with a ring and a badge instead of being
                  painted over, which used to hide the very label the manager
                  is dragging by. */}
              <span className="relative">
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold shadow"
                  style={{
                    background: "var(--bg-raised)",
                    color: fitColor(fit),
                    border: `1.5px solid ${player?.unavailable ? "var(--bad)" : fitColor(fit)}`,
                    boxShadow: player?.unavailable ? "0 0 0 2px rgba(248,81,73,0.35)" : undefined,
                  }}
                >
                  {SLOT_LABEL[placement.slot]}
                </span>
                {player?.unavailable && (
                  <span
                    className="absolute -right-1.5 -top-1 rounded px-0.5 text-[7px] font-bold leading-tight"
                    style={{ background: "var(--bad)", color: "#fff" }}
                    title={player.unavailable === "injured" ? "Injured" : "Suspended"}
                  >
                    {player.unavailable === "injured" ? "I" : "S"}
                  </span>
                )}
              </span>
              <span
                className={`mt-0.5 max-w-full truncate rounded px-1 text-center ${
                  compact ? "text-[8px]" : "text-[9px]"
                }`}
                style={{ background: "rgba(0,0,0,0.55)" }}
              >
                {player ? player.name : "-"}
                {player && captainId === player.id && (
                  <span className="ml-0.5 font-bold text-[var(--accent)]">C</span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-1.5 px-1 text-center text-[10px] text-[var(--text-dim)]">
        Drag to rearrange. Drop onto a teammate to swap. Tap to select, then pick from the squad.
      </p>
    </div>
  );
}

/** Static pitch lines. Purely decorative, so it is inert to pointers. */
export function PitchMarkings() {
  const line = "absolute pointer-events-none border-white/12";
  return (
    <>
      <span className={`${line} left-0 right-0 top-1/2 border-t`} />
      <span
        className={`${line} left-1/2 top-1/2 h-[16%] w-[16%] -translate-x-1/2 -translate-y-1/2 rounded-full border`}
      />
      <span className={`${line} left-[22%] right-[22%] top-0 h-[14%] border-x border-b`} />
      <span className={`${line} left-[22%] right-[22%] bottom-0 h-[14%] border-x border-t`} />
      <span className={`${line} left-[36%] right-[36%] top-0 h-[5.5%] border-x border-b`} />
      <span className={`${line} left-[36%] right-[36%] bottom-0 h-[5.5%] border-x border-t`} />
    </>
  );
}
