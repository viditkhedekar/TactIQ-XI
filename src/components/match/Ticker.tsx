"use client";

import { useEffect, useRef } from "react";
import type { MatchEvent } from "@/engine";

/** Events that are noise in a ticker unless something came of them. */
const MINOR_TYPES = new Set(["foul"]);

/**
 * Lines that are scene-setting rather than incident. They are printed in a
 * quieter style so the eye can skim past them to the football, which is the
 * whole reason it is safe to have a lot of them.
 */
const QUIET_TYPES = new Set(["buildup", "atmosphere", "pundit", "corner", "offside", "var_check"]);

const ACCENT: Partial<Record<MatchEvent["type"], string>> = {
  goal: "var(--good)",
  save: "var(--accent)",
  yellow: "var(--ok)",
  red: "var(--bad)",
  injury: "var(--bad)",
  penalty_awarded: "var(--ok)",
  penalty_missed: "var(--bad)",
  sub: "var(--text-muted)",
  tactic_change: "var(--text-muted)",
  woodwork: "var(--ok)",
  goal_line_clearance: "var(--accent)",
  offside: "var(--text-dim)",
  var_check: "var(--text-dim)",
};

const LABEL: Partial<Record<MatchEvent["type"], string>> = {
  goal: "GOAL",
  yellow: "YELLOW",
  red: "RED",
  injury: "INJURY",
  sub: "SUB",
  penalty_awarded: "PENALTY",
  penalty_missed: "MISSED",
  tactic_change: "TACTICS",
  halftime: "HT",
  fulltime: "FT",
  woodwork: "POST",
  goal_line_clearance: "OFF THE LINE",
  offside: "OFFSIDE",
  var_check: "CHECK",
};

function formatMinute(event: MatchEvent): string {
  if (event.type === "kickoff") return "0'";
  return event.addedTime > 0
    ? `${event.minute}+${event.addedTime}'`
    : `${event.minute}'`;
}

export function Ticker({
  events,
  homeClubId,
  userClubId,
}: {
  events: MatchEvent[];
  homeClubId: number;
  userClubId: number;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  // Follow the commentary as it arrives, the way a live blog does.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [events.length]);

  const shown = events.filter((e) => !MINOR_TYPES.has(e.type));

  return (
    <div className="max-h-[540px] min-h-[240px] overflow-y-auto">
      {shown.length === 0 ? (
        <p className="px-3 py-8 text-center text-[var(--text-muted)]">
          The teams are lining up.
        </p>
      ) : (
        <ul>
          {shown.map((event) => {
            const isBreak = event.type === "halftime" || event.type === "fulltime";
            const isUserEvent = event.clubId === userClubId;
            const label = LABEL[event.type];

            if (isBreak) {
              return (
                <li
                  key={event.seq}
                  className="border-y border-[var(--border-strong)] bg-[var(--bg-hover)] px-3 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]"
                >
                  {event.commentary}
                </li>
              );
            }

            return (
              <li
                key={event.seq}
                className={`flex gap-2 border-b border-[var(--border)] px-3 py-1.5 last:border-0 ${
                  event.type === "goal" ? "bg-[rgba(63,185,80,0.07)]" : ""
                }`}
              >
                <span className="numeric w-10 shrink-0 text-right text-[11px] text-[var(--text-dim)]">
                  {formatMinute(event)}
                </span>

                <span className="min-w-0 flex-1">
                  {label && (
                    <span
                      className="mr-1.5 rounded px-1 py-0.5 text-[9px] font-bold tracking-wide"
                      style={{
                        color: ACCENT[event.type] ?? "var(--text-muted)",
                        background: "color-mix(in srgb, currentColor 14%, transparent)",
                      }}
                    >
                      {label}
                    </span>
                  )}
                  <span
                    className={
                      event.type === "goal"
                        ? "font-medium"
                        : event.type === "pundit"
                          ? "italic text-[var(--text-dim)]"
                          : QUIET_TYPES.has(event.type)
                            ? "text-[var(--text-dim)]"
                            : isUserEvent
                              ? ""
                              : "text-[var(--text-muted)]"
                    }
                  >
                    {event.commentary}
                  </span>
                </span>

                {event.clubId !== null && (
                  <span className="w-8 shrink-0 text-right text-[9px] uppercase text-[var(--text-dim)]">
                    {event.clubId === homeClubId ? "home" : "away"}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div ref={endRef} />
    </div>
  );
}
