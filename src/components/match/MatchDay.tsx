"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMatchStore, visibleEvents, type SideSummary } from "@/store/matchStore";
import { Button, Panel } from "@/components/ui/primitives";
import { Ticker } from "./Ticker";
import { TacticsDrawer } from "./TacticsDrawer";

/** Boundaries the manager is likely to want to react to. */
const PROMPT_BOUNDARIES = new Set(["goal", "red_card", "injury", "halftime"]);

export function MatchDay({ homeColor, awayColor }: { homeColor?: string; awayColor?: string }) {
  const router = useRouter();
  const store = useMatchStore();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);

  // Guards against two advance requests overlapping, which would double up the
  // event stream and leave the ticker showing minutes twice.
  const inFlight = useRef(false);
  const started = useRef(false);

  const {
    phase,
    events,
    revealedMinute,
    serverMinute,
    home,
    away,
    finished,
    error,
    speed,
    boundary,
  } = store;

  /* --------------------------------------------------------------- opening */

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      store.setPhase("loading");
      try {
        const response = await fetch("/api/match/start", { method: "POST" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Could not start the match");
        store.startMatch(body);
      } catch (e) {
        store.setError(e instanceof Error ? e.message : "Could not start the match");
        store.setPhase("idle");
      }
    })();
    // Runs once on mount; the ref guard is what enforces that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------------------------------ asking for more */

  const requestMore = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      // The server needs to know how far the ticker has got, so it never moves
      // the rewind point past what the manager can see.
      const response = await fetch("/api/match/advance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revealedMinute: useMatchStore.getState().revealedMinute }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not advance the match");
      useMatchStore.getState().appendSegment(body);
    } catch (e) {
      useMatchStore
        .getState()
        .setError(e instanceof Error ? e.message : "Could not advance the match");
    } finally {
      inFlight.current = false;
    }
  }, []);

  // Fetch the next segment while the ticker is still working through this one,
  // so playback does not stall waiting on the network.
  useEffect(() => {
    if (phase !== "playing" || finished) return;
    if (serverMinute - revealedMinute > 4) return;
    void requestMore();
  }, [phase, finished, serverMinute, revealedMinute, requestMore]);

  /* ------------------------------------------------------------ the clock */

  useEffect(() => {
    if (phase !== "playing") return;
    const timer = setInterval(() => useMatchStore.getState().advanceTicker(), speed);
    return () => clearInterval(timer);
  }, [phase, speed]);

  // Stop automatically at the moments a manager would want to react to.
  useEffect(() => {
    if (phase !== "playing") return;
    if (!boundary || !PROMPT_BOUNDARIES.has(boundary)) return;
    if (revealedMinute < serverMinute) return;
    if (finished) return;
    useMatchStore.getState().pause();
  }, [phase, boundary, revealedMinute, serverMinute, finished]);

  /* ------------------------------------------------------------- finishing */

  async function finishRound() {
    setFinishing(true);
    try {
      const response = await fetch("/api/match/finish", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not finish the round");
      useMatchStore.getState().markSettled();
      router.push("/career/fixtures");
      router.refresh();
    } catch (e) {
      store.setError(e instanceof Error ? e.message : "Could not finish the round");
      setFinishing(false);
    }
  }

  /* --------------------------------------------------------------- render */

  if (error && !home) {
    return (
      <Panel>
        <div className="space-y-3 p-4">
          <p className="text-[var(--bad)]">{error}</p>
          <Button onClick={() => router.push("/career/squad")}>Back to squad</Button>
        </div>
      </Panel>
    );
  }

  if (!home || !away) {
    return (
      <Panel>
        <p className="p-6 text-center text-[var(--text-muted)]">Walking out of the tunnel...</p>
      </Panel>
    );
  }

  const shown = visibleEvents(events, revealedMinute);
  const userSide: SideSummary = home.isUser ? home : away;
  const displayMinute = Math.min(revealedMinute, 90 + 6);

  // The score comes from the events the manager has actually seen, not from
  // the server's running total. The server simulates ahead of the ticker, so
  // using its figures would put goals on the scoreboard minutes before the
  // commentary describes them.
  const shownGoals = (clubId: number) =>
    shown.filter((e) => e.type === "goal" && e.clubId === clubId).length;
  const visibleHomeGoals = shownGoals(home.clubId);
  const visibleAwayGoals = shownGoals(away.clubId);

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-3">
        <Scoreboard
          home={home}
          away={away}
          homeGoals={visibleHomeGoals}
          awayGoals={visibleAwayGoals}
          minute={displayMinute}
          phase={phase}
          homeColor={homeColor}
          awayColor={awayColor}
        />

        <Panel
          title="Commentary"
          action={
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-[var(--text-dim)]">Speed</span>
              {[
                { label: "Slow", value: 1100 },
                { label: "Normal", value: 600 },
                { label: "Fast", value: 260 },
                { label: "Rapid", value: 90 },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => store.setSpeed(option.value)}
                  className={`rounded px-1.5 py-0.5 text-[11px] transition-colors ${
                    speed === option.value
                      ? "bg-[var(--accent-dim)] text-white"
                      : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          }
        >
          <Ticker events={shown} homeClubId={home.clubId} userClubId={userSide.clubId} />
        </Panel>

        <div className="flex flex-wrap items-center gap-2">
          {phase === "playing" && (
            <Button onClick={() => store.pause()}>Pause</Button>
          )}
          {phase === "paused" && (
            <>
              <Button variant="primary" onClick={() => store.resume()}>
                Resume
              </Button>
              <Button onClick={() => setDrawerOpen(true)}>Make changes</Button>
            </>
          )}
          {phase === "finished" && (
            <Button variant="primary" onClick={finishRound} disabled={finishing}>
              {finishing ? "Settling the round..." : "Continue to results"}
            </Button>
          )}
          {error && <span className="text-[11px] text-[var(--bad)]">{error}</span>}
        </div>
      </div>

      <MatchStats
        events={shown}
        homeClubId={home.clubId}
        awayClubId={away.clubId}
        home={home}
        away={away}
      />

      {drawerOpen && (
        <TacticsDrawer
          side={userSide}
          atMinute={revealedMinute}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </div>
  );
}

function Scoreboard({
  home,
  away,
  homeGoals,
  awayGoals,
  minute,
  phase,
  homeColor,
  awayColor,
}: {
  home: SideSummary;
  away: SideSummary;
  homeGoals: number;
  awayGoals: number;
  minute: number;
  phase: string;
  homeColor?: string;
  awayColor?: string;
}) {
  return (
    <Panel>
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <TeamName side={home} color={homeColor} align="right" />

        <div className="shrink-0 text-center">
          <div className="numeric text-3xl font-bold leading-none">
            {homeGoals} <span className="text-[var(--text-dim)]">-</span> {awayGoals}
          </div>
          <div className="numeric mt-1 text-[11px] text-[var(--text-muted)]">
            {phase === "finished"
              ? "Full time"
              : phase === "loading"
                ? "Kick off"
                : `${minute}'`}
            {phase === "paused" && (
              <span className="ml-1.5 text-[var(--ok)]">paused</span>
            )}
          </div>
        </div>

        <TeamName side={away} color={awayColor} align="left" />
      </div>
    </Panel>
  );
}

function TeamName({
  side,
  color,
  align,
}: {
  side: SideSummary;
  color?: string;
  align: "left" | "right";
}) {
  return (
    <div className={`min-w-0 flex-1 ${align === "right" ? "text-right" : "text-left"}`}>
      <p className="truncate text-base font-semibold">
        {side.clubName}
        {side.isUser && <span className="ml-1.5 text-[10px] text-[var(--accent)]">YOU</span>}
      </p>
      <p className="text-[11px] text-[var(--text-dim)]">
        {side.tactics.formation}
        <span
          className="ml-1.5 inline-block h-2 w-2 rounded-full align-middle ring-1 ring-white/25"
          style={{ background: color ?? "var(--border-strong)" }}
        />
      </p>
    </div>
  );
}

/** Live statistics, counted from the events the manager has actually seen. */
function MatchStats({
  events,
  homeClubId,
  awayClubId,
  home,
  away,
}: {
  events: { type: string; clubId: number | null; data: { xg?: number } | null }[];
  homeClubId: number;
  awayClubId: number;
  home: SideSummary;
  away: SideSummary;
}) {
  const count = (clubId: number, types: string[]) =>
    events.filter((e) => e.clubId === clubId && types.includes(e.type)).length;

  const shotTypes = ["goal", "save", "shot_off", "shot_blocked", "penalty_missed"];
  const onTargetTypes = ["goal", "save"];

  const xg = (clubId: number) =>
    events
      .filter((e) => e.clubId === clubId && shotTypes.includes(e.type))
      .reduce((sum, e) => sum + (e.data?.xg ?? 0), 0);

  const rows: { label: string; home: string; away: string; homeRaw: number; awayRaw: number }[] = [
    {
      label: "Shots",
      home: String(count(homeClubId, shotTypes)),
      away: String(count(awayClubId, shotTypes)),
      homeRaw: count(homeClubId, shotTypes),
      awayRaw: count(awayClubId, shotTypes),
    },
    {
      label: "On target",
      home: String(count(homeClubId, onTargetTypes)),
      away: String(count(awayClubId, onTargetTypes)),
      homeRaw: count(homeClubId, onTargetTypes),
      awayRaw: count(awayClubId, onTargetTypes),
    },
    {
      label: "Expected goals",
      home: xg(homeClubId).toFixed(2),
      away: xg(awayClubId).toFixed(2),
      homeRaw: xg(homeClubId),
      awayRaw: xg(awayClubId),
    },
    {
      label: "Fouls",
      home: String(count(homeClubId, ["foul", "yellow", "red"])),
      away: String(count(awayClubId, ["foul", "yellow", "red"])),
      homeRaw: count(homeClubId, ["foul", "yellow", "red"]),
      awayRaw: count(awayClubId, ["foul", "yellow", "red"]),
    },
    {
      label: "Bookings",
      home: String(count(homeClubId, ["yellow"])),
      away: String(count(awayClubId, ["yellow"])),
      homeRaw: count(homeClubId, ["yellow"]),
      awayRaw: count(awayClubId, ["yellow"]),
    },
  ];

  return (
    <div className="space-y-3">
      <Panel title="Match statistics">
        <div className="space-y-2 p-3">
          {rows.map((row) => {
            const total = row.homeRaw + row.awayRaw;
            const homeShare = total > 0 ? (row.homeRaw / total) * 100 : 50;
            return (
              <div key={row.label}>
                <div className="mb-0.5 flex items-center justify-between text-[11px]">
                  <span className="numeric font-medium">{row.home}</span>
                  <span className="text-[var(--text-muted)]">{row.label}</span>
                  <span className="numeric font-medium">{row.away}</span>
                </div>
                <div className="flex h-1 overflow-hidden rounded-full bg-[var(--border)]">
                  <span style={{ width: `${homeShare}%`, background: "var(--accent)" }} />
                  <span style={{ width: `${100 - homeShare}%`, background: "var(--text-dim)" }} />
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="On the pitch">
        <div className="grid grid-cols-2 gap-px bg-[var(--border)] text-[11px]">
          <SideList side={home} />
          <SideList side={away} />
        </div>
      </Panel>
    </div>
  );
}

function SideList({ side }: { side: SideSummary }) {
  return (
    <div className="bg-[var(--bg-raised)] p-2">
      <p className="mb-1 truncate font-semibold">{side.clubName}</p>
      <ul className="space-y-0.5">
        {side.onPitch.map((player) => (
          <li key={player.id} className="flex items-center gap-1">
            <span className="w-6 shrink-0 text-[9px] text-[var(--text-dim)]">{player.slot}</span>
            <span className="min-w-0 flex-1 truncate">{player.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
