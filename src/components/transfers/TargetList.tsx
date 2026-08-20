"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Attr, Button, EmptyState } from "@/components/ui/primitives";
import { BidForm } from "./BidForm";
import type { TransferTargetView } from "@/lib/transferService";

/**
 * The scouting list.
 *
 * Filtering happens in the browser over a list the server already narrowed,
 * because a manager scanning for a centre back wants the list to react as they
 * type rather than after a round trip.
 */
export function TargetList({
  targets,
  budget,
  wageRoom,
  windowOpen,
}: {
  targets: TransferTargetView[];
  budget: number;
  wageRoom: number;
  windowOpen: boolean;
}) {
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState("all");
  const [affordableOnly, setAffordableOnly] = useState(false);
  const [bidding, setBidding] = useState<TransferTargetView | null>(null);

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return targets.filter((t) => {
      if (term && !t.name.toLowerCase().includes(term)) return false;
      if (position !== "all" && !t.positions.some((p) => GROUPS[position]?.includes(p))) {
        return false;
      }
      if (affordableOnly && (t.askingPrice > budget || t.wageDemand > wageRoom)) return false;
      return true;
    });
  }, [targets, search, position, affordableOnly, budget, wageRoom]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search players"
          aria-label="Search players"
          className="min-w-[160px] flex-1 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[12px] placeholder:text-[var(--text-dim)]"
        />

        <div className="flex gap-1">
          {["all", "GK", "DEF", "MID", "ATT"].map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setPosition(option)}
              aria-pressed={position === option}
              className={`rounded px-2 py-1 text-[11px] transition-colors ${
                position === option
                  ? "bg-[var(--accent-dim)] text-white"
                  : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              {option === "all" ? "All" : option}
            </button>
          ))}
        </div>

        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
          <input
            type="checkbox"
            checked={affordableOnly}
            onChange={(e) => setAffordableOnly(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          Can afford
        </label>
      </div>

      {shown.length === 0 ? (
        <EmptyState>Nobody matches that.</EmptyState>
      ) : (
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-[var(--bg-raised)]">
              <tr className="border-b border-[var(--border)] text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
                <th className="px-3 py-1.5 font-medium">Player</th>
                <th className="px-1 py-1.5 font-medium">Club</th>
                <th className="px-1 py-1.5 font-medium">Pos</th>
                <th className="px-1 py-1.5 text-right font-medium">Age</th>
                <th className="px-1 py-1.5 text-right font-medium">Ovr</th>
                <th className="px-1 py-1.5 text-right font-medium">Pot</th>
                <th className="px-2 py-1.5 text-right font-medium">Asking</th>
                <th className="px-2 py-1.5 text-right font-medium">Wage</th>
                <th className="px-3 py-1.5 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => {
                const affordable = t.askingPrice <= budget && t.wageDemand <= wageRoom;
                return (
                  <tr
                    key={t.playerId}
                    className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-hover)]"
                  >
                    <td className="px-3 py-1">
                      <Link
                        href={`/career/player/${t.playerId}`}
                        className="hover:text-[var(--accent)]"
                      >
                        {t.name}
                      </Link>
                    </td>
                    <td className="max-w-[120px] truncate px-1 py-1 text-[11px] text-[var(--text-muted)]">
                      {t.clubName}
                    </td>
                    <td className="px-1 py-1 text-[10px] text-[var(--text-dim)]">
                      {t.positions[0]}
                    </td>
                    <td className="numeric px-1 py-1 text-right text-[11px] text-[var(--text-muted)]">
                      {t.age}
                    </td>
                    <td className="px-1 py-1 text-right">
                      <Attr value={t.overall} />
                    </td>
                    <td className="numeric px-1 py-1 text-right text-[11px] text-[var(--text-dim)]">
                      {t.potential}
                    </td>
                    <td
                      className="numeric px-2 py-1 text-right text-[11px]"
                      style={{ color: affordable ? "var(--text)" : "var(--bad)" }}
                    >
                      {formatEur(t.askingPrice)}
                    </td>
                    <td className="numeric px-2 py-1 text-right text-[11px] text-[var(--text-muted)]">
                      {formatEur(t.wageDemand)}
                    </td>
                    <td className="px-3 py-1 text-right">
                      {t.existingOfferStatus ? (
                        <span className="text-[10px] uppercase text-[var(--ok)]">bid in</span>
                      ) : (
                        <Button
                          size="sm"
                          disabled={!windowOpen}
                          onClick={() => setBidding(t)}
                          title={windowOpen ? undefined : "The window is shut"}
                        >
                          Bid
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {bidding && (
        <BidForm
          playerId={bidding.playerId}
          playerName={bidding.name}
          clubName={bidding.clubName}
          askingPrice={bidding.askingPrice}
          wageDemand={bidding.wageDemand}
          budget={budget}
          wageRoom={wageRoom}
          onClose={() => setBidding(null)}
        />
      )}
    </>
  );
}

const GROUPS: Record<string, string[]> = {
  GK: ["GK"],
  DEF: ["CB", "LB", "RB", "LWB", "RWB"],
  MID: ["CDM", "CM", "CAM", "LM", "RM"],
  ATT: ["LW", "RW", "CF", "ST"],
};

function formatEur(amount: number): string {
  if (amount >= 1_000_000) {
    const millions = amount / 1_000_000;
    return `€${millions >= 100 ? Math.round(millions) : millions.toFixed(1)}m`;
  }
  if (amount >= 1_000) return `€${Math.round(amount / 1_000)}k`;
  return `€${Math.round(amount)}`;
}
