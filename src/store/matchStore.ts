/**
 * Live match state in the browser.
 *
 * The server simulates ahead of what the manager is watching: a request may
 * return fifteen minutes of events at once, which the ticker then reveals one
 * minute at a time. This store owns that gap. `revealedMinute` is what the
 * manager can see, and it is the minute sent back when they intervene, so the
 * server rewinds to exactly the point they were looking at.
 */

import { create } from "zustand";
import type { MatchEvent, PitchPlacement, SegmentBoundary, TeamTactics } from "@/engine";

export type SidePlayer = {
  id: number;
  name: string;
  slot?: string;
  isGk: boolean;
  fitness: number;
};

export type SideSummary = {
  clubId: number;
  clubName: string;
  isUser: boolean;
  /**
   * The side's whole plan, not just the five original sliders. The mid-match
   * drawer offers everything the tactics screen does, so it needs everything
   * the tactics screen has.
   */
  tactics: TeamTactics;
  /** Where the eleven are standing, so the drawer can show the same board. */
  placements?: PitchPlacement[];
  onPitch: SidePlayer[];
  bench: SidePlayer[];
};

export type MatchPhase = "idle" | "loading" | "playing" | "paused" | "finished";

type MatchStore = {
  phase: MatchPhase;
  fixtureId: string | null;
  home: SideSummary | null;
  away: SideSummary | null;

  /** Every event received, in order. */
  events: MatchEvent[];
  /** How far the ticker has revealed. Events beyond this stay hidden. */
  revealedMinute: number;
  /** How far the server has simulated. */
  serverMinute: number;

  homeGoals: number;
  awayGoals: number;
  boundary: SegmentBoundary | null;
  finished: boolean;
  /** Set once the round has been settled, so Finish cannot run twice. */
  settled: boolean;
  error: string | null;
  /** Real milliseconds per simulated minute. */
  speed: number;

  setSpeed: (speed: number) => void;
  setError: (error: string | null) => void;
  startMatch: (payload: {
    fixtureId: string;
    home: SideSummary;
    away: SideSummary;
    minute: number;
    homeGoals: number;
    awayGoals: number;
    finished: boolean;
    /** Commentary already recorded, when rejoining a match in progress. */
    events?: MatchEvent[];
  }) => void;
  appendSegment: (payload: {
    events: MatchEvent[];
    minute: number;
    boundary: SegmentBoundary;
    homeGoals: number;
    awayGoals: number;
    finished: boolean;
  }) => void;
  /** Replaces everything from a rewind point, after an intervention. */
  replaceFrom: (payload: {
    fromMinute: number;
    events: MatchEvent[];
    minute: number;
    boundary: SegmentBoundary;
    homeGoals: number;
    awayGoals: number;
    finished: boolean;
  }) => void;
  advanceTicker: () => void;
  pause: () => void;
  resume: () => void;
  setPhase: (phase: MatchPhase) => void;
  markSettled: () => void;
  applyLocalSub: (off: number, on: number) => void;
  applyLocalTactics: (tactics: Partial<TeamTactics>) => void;
  applyLocalPlacements: (placements: PitchPlacement[]) => void;
  reset: () => void;
};

/** Events at or before the revealed minute, which is what the ticker shows. */
export function visibleEvents(events: MatchEvent[], revealedMinute: number): MatchEvent[] {
  return events.filter((e) => e.minute <= revealedMinute);
}

const INITIAL = {
  phase: "idle" as MatchPhase,
  fixtureId: null,
  home: null,
  away: null,
  events: [],
  revealedMinute: 0,
  serverMinute: 0,
  homeGoals: 0,
  awayGoals: 0,
  boundary: null,
  finished: false,
  settled: false,
  error: null,
  speed: 600,
};

export const useMatchStore = create<MatchStore>((set, get) => ({
  ...INITIAL,

  setSpeed: (speed) => set({ speed }),
  setError: (error) => set({ error }),
  setPhase: (phase) => set({ phase }),
  markSettled: () => set({ settled: true }),

  startMatch: ({ fixtureId, home, away, minute, homeGoals, awayGoals, finished, events }) =>
    set({
      ...INITIAL,
      fixtureId,
      home,
      away,
      events: events ?? [],
      // Rejoining shows everything up to now straight away, rather than
      // replaying an hour of football the manager has already watched.
      revealedMinute: minute,
      serverMinute: minute,
      homeGoals,
      awayGoals,
      finished,
      phase: finished ? "finished" : "playing",
    }),

  appendSegment: ({ events, minute, boundary, homeGoals, awayGoals, finished }) =>
    set((state) => ({
      events: [...state.events, ...events],
      serverMinute: minute,
      boundary,
      homeGoals,
      awayGoals,
      finished,
    })),

  replaceFrom: ({ fromMinute, events, minute, boundary, homeGoals, awayGoals, finished }) =>
    set((state) => ({
      // Anything after the pause is discarded: the server has re-simulated it.
      events: [...state.events.filter((e) => e.minute <= fromMinute), ...events],
      serverMinute: minute,
      revealedMinute: fromMinute,
      boundary,
      homeGoals,
      awayGoals,
      finished,
      phase: finished ? "finished" : "playing",
    })),

  advanceTicker: () => {
    const { revealedMinute, serverMinute, finished, phase } = get();
    if (phase !== "playing") return;

    if (revealedMinute < serverMinute) {
      set({ revealedMinute: revealedMinute + 1 });
      return;
    }

    // Caught up with the server and the match is over.
    if (finished) set({ phase: "finished" });
  },

  pause: () => set((state) => (state.phase === "playing" ? { phase: "paused" } : {})),
  resume: () => set((state) => (state.phase === "paused" ? { phase: "playing" } : {})),

  /**
   * Mirrors an accepted substitution locally so the bench and pitch lists
   * update immediately, rather than waiting for the next server response.
   */
  applyLocalSub: (off, on) =>
    set((state) => {
      const side = state.home?.isUser ? state.home : state.away;
      if (!side) return {};

      const offIndex = side.onPitch.findIndex((p) => p.id === off);
      const onIndex = side.bench.findIndex((p) => p.id === on);
      if (offIndex === -1 || onIndex === -1) return {};

      const onPitch = [...side.onPitch];
      const bench = [...side.bench];
      const [replacement] = bench.splice(onIndex, 1);
      const [replaced] = onPitch.splice(offIndex, 1, {
        ...replacement,
        slot: onPitch[offIndex].slot,
      });
      bench.push({ ...replaced, fitness: replaced.fitness });

      const updated = { ...side, onPitch, bench };
      return state.home?.isUser ? { home: updated } : { away: updated };
    }),

  applyLocalTactics: (tactics) =>
    set((state) => {
      const side = state.home?.isUser ? state.home : state.away;
      if (!side) return {};
      const updated = { ...side, tactics: { ...side.tactics, ...tactics } };
      return state.home?.isUser ? { home: updated } : { away: updated };
    }),

  applyLocalPlacements: (placements) =>
    set((state) => {
      const side = state.home?.isUser ? state.home : state.away;
      if (!side) return {};
      const updated = { ...side, placements };
      return state.home?.isUser ? { home: updated } : { away: updated };
    }),

  reset: () => set({ ...INITIAL }),
}));
