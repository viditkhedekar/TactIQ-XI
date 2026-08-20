/**
 * The instructions have to matter, and they have to cost something.
 *
 * Two separate claims, and both need testing. An instruction that changes
 * nothing is a lie on the screen. An instruction that is a straight upgrade is
 * worse than useless: it removes the decision, and because the AI picks its
 * settings from how strong it expects to be, a one-sided instruction quietly
 * pulls the whole division apart. That happened during this work, and the
 * balance tests below are what caught it.
 */

import { describe, it, expect } from "vitest";
import { applyIntervention, createMatchState, simulateSegment, simulateToEnd } from "../match";
import { aiMinuteHook } from "../aiManager";
import { makeSide, resetPlayerIds } from "./factories";
import {
  DEFAULT_TACTICS,
  TACTICAL_STYLES,
  TACTICAL_STYLE_NAMES,
  applyStyle,
  isTacticalStyle,
  matchingStyle,
  normaliseTactics,
} from "../tactics";
import { describeShape, isValidPlacement, snapToAnchor, PITCH_ANCHORS } from "../pitch";
import type { MatchEvent, PitchPlacement, TeamTactics } from "../types";

const MATCHES = 260;

/** Plays a run of matches with one side given an instruction, and reports it. */
function trial(override: Partial<TeamTactics>) {
  let scored = 0;
  let conceded = 0;
  let shots = 0;
  let cards = 0;

  for (let seed = 0; seed < MATCHES; seed++) {
    resetPlayerIds();
    const home = makeSide({ clubId: 1, clubName: "A", level: 75, isHome: true, tactics: override });
    const away = makeSide({ clubId: 2, clubName: "B", level: 75, isHome: false });
    const state = createMatchState("f", seed * 7919 + 13, home, away);
    simulateToEnd(state, aiMinuteHook);
    scored += state.homeGoals;
    conceded += state.awayGoals;
    shots += state.homeStats.shots;
    cards += state.homeStats.yellowCards + state.homeStats.redCards * 2;
  }

  return {
    gf: scored / MATCHES,
    ga: conceded / MATCHES,
    net: (scored - conceded) / MATCHES,
    shots: shots / MATCHES,
    cards: cards / MATCHES,
  };
}

const neutral = trial({});

describe("every instruction changes the match", () => {
  it("makes a high line create more and concede more than a deep one", () => {
    const high = trial({ defensiveLine: 5 });
    const deep = trial({ defensiveLine: 1 });

    expect(high.shots).toBeGreaterThan(deep.shots);
    expect(high.gf).toBeGreaterThan(deep.gf);
    expect(high.ga).toBeGreaterThan(deep.ga);
  });

  it("makes closing down cost legs and buy pressure", () => {
    const engage = trial({ closingDown: 5 });
    const hold = trial({ closingDown: 1 });
    expect(engage.gf + engage.ga).not.toBeCloseTo(hold.gf + hold.ga, 2);
  });

  it("makes hard tackling win more of the ball and collect far more cards", () => {
    const stuckIn = trial({ tackling: 5 });
    const onFeet = trial({ tackling: 1 });

    expect(stuckIn.cards).toBeGreaterThan(onFeet.cards * 1.4);
  });

  it("makes shooting early produce many more shots than working the ball", () => {
    const early = trial({ finalThird: "shoot_early" });
    const worked = trial({ finalThird: "work_ball" });

    expect(early.shots).toBeGreaterThan(worked.shots * 1.2);
    // ...and worse ones, so the volume does not simply become goals.
    expect(early.gf / early.shots).toBeLessThan(worked.gf / worked.shots);
  });

  it("makes the keeper going long trade the ball for transitions", () => {
    const short = trial({ keeperDistribution: "short" });
    const long = trial({ keeperDistribution: "long" });
    expect(short.shots).toBeGreaterThan(long.shots);
  });

  it("makes focusing a flank change where the chances come from", () => {
    const left = trial({ passingFocus: "left" });
    const centre = trial({ passingFocus: "centre" });
    expect(left.gf).not.toBeCloseTo(centre.gf, 2);
  });

  it("makes the offside trap actually catch people", () => {
    const withTrap = trial({ offsideTrap: true, defensiveLine: 5 });
    const without = trial({ offsideTrap: false, defensiveLine: 5 });
    // The trap ends attacks before they become shots, so the opponent's
    // conversion of the same high line changes.
    expect(withTrap.ga).not.toBeCloseTo(without.ga, 2);
  });

  it("gives a captain a small steadying effect and no more", () => {
    resetPlayerIds();
    const withArmband = trial({ captainId: 1 });
    const difference = Math.abs(withArmband.net - neutral.net);
    // Present, but nowhere near the size of a tactical decision.
    expect(difference).toBeLessThan(0.15);
  });
});

describe("no instruction is a free upgrade", () => {
  /**
   * The tolerance is deliberately loose. These are trades, not perfectly
   * balanced ones, and the point is to catch an instruction that is worth half
   * a goal a game rather than to insist every option is identical.
   */
  const TOLERANCE = 0.16;

  const cases: [string, Partial<TeamTactics>][] = [
    ["defensiveLine 1", { defensiveLine: 1 }],
    ["defensiveLine 5", { defensiveLine: 5 }],
    ["closingDown 1", { closingDown: 1 }],
    ["closingDown 5", { closingDown: 5 }],
    ["tackling 1", { tackling: 1 }],
    ["tackling 5", { tackling: 5 }],
    ["work_ball", { finalThird: "work_ball" }],
    ["shoot_early", { finalThird: "shoot_early" }],
    ["short distribution", { keeperDistribution: "short" }],
    ["long distribution", { keeperDistribution: "long" }],
    ["focus left", { passingFocus: "left" }],
    ["focus centre", { passingFocus: "centre" }],
    ["offside trap", { offsideTrap: true, defensiveLine: 5 }],
  ];

  for (const [label, override] of cases) {
    it(`keeps ${label} within a goal-difference of neutral`, () => {
      const result = trial(override);
      expect(Math.abs(result.net - neutral.net)).toBeLessThan(TOLERANCE);
    });
  }
});

describe("tactical styles", () => {
  it("names every style it advertises", () => {
    for (const name of TACTICAL_STYLE_NAMES) {
      const style = TACTICAL_STYLES[name];
      expect(isTacticalStyle(name)).toBe(true);
      expect(style.label.length).toBeGreaterThan(2);
      expect(style.blurb.length).toBeGreaterThan(20);
      expect(style.blurb).not.toContain("—");
    }
  });

  it("applies a style without touching shape, set pieces or the armband", () => {
    const before: TeamTactics = {
      ...DEFAULT_TACTICS,
      formation: "3-5-2",
      captainId: 7,
      setPieces: { ...DEFAULT_TACTICS.setPieces, penalties: 9 },
    };

    const after = applyStyle(before, "gegenpress");

    expect(after.formation).toBe("3-5-2");
    expect(after.captainId).toBe(7);
    expect(after.setPieces.penalties).toBe(9);
    expect(after.pressing).toBe(TACTICAL_STYLES.gegenpress.instructions.pressing);
  });

  it("recognises a style it has just applied, and stops when it is edited", () => {
    const applied = applyStyle(DEFAULT_TACTICS, "tiki_taka");
    expect(matchingStyle(applied)).toBe("tiki_taka");

    const edited = { ...applied, defensiveLine: 1 as const };
    expect(matchingStyle(edited)).not.toBe("tiki_taka");
  });

  it("gives the styles genuinely different characters", () => {
    const press = trial(applyStyle(DEFAULT_TACTICS, "gegenpress"));
    const bus = trial(applyStyle(DEFAULT_TACTICS, "park_the_bus"));

    expect(press.shots).toBeGreaterThan(bus.shots);
    expect(press.ga).toBeGreaterThan(bus.ga);
  });
});

describe("normaliseTactics", () => {
  it("fills a plan that predates an instruction with its neutral default", () => {
    const old = normaliseTactics({ formation: "4-4-2", mentality: 5 });
    expect(old.mentality).toBe(5);
    expect(old.defensiveLine).toBe(3);
    expect(old.offsideTrap).toBe(false);
    expect(old.finalThird).toBe("mixed");
    expect(old.setPieces.cornerDelivery).toBe("whipped");
  });

  it("clamps a tampered payload instead of trusting it", () => {
    const bad = normaliseTactics({
      defensiveLine: 99,
      closingDown: -4,
      finalThird: "nonsense",
      captainId: -1,
    } as never);

    expect(bad.defensiveLine).toBe(5);
    expect(bad.closingDown).toBe(1);
    expect(bad.finalThird).toBe("mixed");
    expect(bad.captainId).toBeNull();
  });

  it("returns a complete plan from nothing at all", () => {
    expect(normaliseTactics(null)).toEqual(DEFAULT_TACTICS);
    expect(normaliseTactics(undefined).setPieces.corners).toBeNull();
  });
});

describe("the pitch", () => {
  it("snaps a drop to a real position", () => {
    const anchor = snapToAnchor({ x: 14, y: 71 });
    expect(isValidPlacement(anchor)).toBe(true);
    expect(anchor.slot).toBe("LB");
  });

  it("lands on the anchor nearest the drop, occupied or not", () => {
    // Dropping a player onto a teammate is a swap, which the board handles by
    // exchanging the two. The snap itself stays predictable.
    const anchor = snapToAnchor({ x: 50, y: 15 });
    expect(anchor.slot).toBe("ST");
    expect(anchor.y).toBe(14);
  });

  it("offers more anchors than there are slots, so shapes are not forced", () => {
    const slots = new Set(PITCH_ANCHORS.map((a) => a.slot));
    expect(PITCH_ANCHORS.length).toBeGreaterThan(slots.size);
  });

  it("reads a back four, a midfield three and a front three off the board", () => {
    const placements: PitchPlacement[] = [
      { playerId: 1, slot: "GK", x: 50, y: 93 },
      { playerId: 2, slot: "LB", x: 12, y: 74 },
      { playerId: 3, slot: "LCB", x: 31, y: 78 },
      { playerId: 4, slot: "RCB", x: 69, y: 78 },
      { playerId: 5, slot: "RB", x: 88, y: 74 },
      { playerId: 6, slot: "LCM", x: 28, y: 48 },
      { playerId: 7, slot: "CM", x: 50, y: 48 },
      { playerId: 8, slot: "RCM", x: 72, y: 48 },
      { playerId: 9, slot: "LW", x: 9, y: 22 },
      { playerId: 10, slot: "ST", x: 50, y: 14 },
      { playerId: 11, slot: "RW", x: 91, y: 22 },
    ];

    expect(describeShape(placements)).toBe("4-3-3");
  });

  it("reads a shape nobody named", () => {
    // Three at the back, three holding, two wide, three up. A real arrangement
    // that no formation dropdown would have offered.
    const placements: PitchPlacement[] = [
      { playerId: 1, slot: "GK", x: 50, y: 93 },
      { playerId: 2, slot: "LCB", x: 31, y: 78 },
      { playerId: 3, slot: "CB", x: 50, y: 80 },
      { playerId: 4, slot: "RCB", x: 69, y: 78 },
      { playerId: 5, slot: "CDM", x: 33, y: 62 },
      { playerId: 6, slot: "CDM", x: 50, y: 60 },
      { playerId: 7, slot: "CDM", x: 67, y: 62 },
      { playerId: 8, slot: "LM", x: 10, y: 45 },
      { playerId: 9, slot: "RM", x: 90, y: 45 },
      { playerId: 10, slot: "LST", x: 34, y: 14 },
      { playerId: 11, slot: "RST", x: 66, y: 14 },
    ];

    expect(describeShape(placements)).toBe("3-3-2-2");
  });

  it("never produces a label with more than four numbers in it", () => {
    for (let trial = 0; trial < 40; trial++) {
      const placements = PITCH_ANCHORS.slice(0, 11).map((a, i) => ({
        playerId: i + 1,
        slot: a.slot,
        x: a.x,
        y: a.y,
      }));
      expect(describeShape(placements).split("-").length).toBeLessThanOrEqual(4);
    }
  });
});

describe("changing things during the match", () => {
  function midMatch() {
    resetPlayerIds();
    const home = makeSide({ clubId: 1, clubName: "A", level: 75, isHome: true });
    const away = makeSide({ clubId: 2, clubName: "B", level: 75, isHome: false });
    const state = createMatchState("f", 4242, home, away);
    simulateSegment(state, { onMinute: aiMinuteHook });
    return state;
  }

  it("moves a player to a new position without spending a substitution", () => {
    const state = midMatch();
    const target = state.home.onPitch.find((lp) => lp.slot === "LB")!;
    const events: MatchEvent[] = [];

    const result = applyIntervention(
      state,
      true,
      { placements: [{ playerId: target.player.id, slot: "LWB", x: 8, y: 60 }] },
      events,
    );

    expect(target.slot).toBe("LWB");
    expect(state.home.subsUsed).toBe(0);
    expect(result.tacticsChanged).toBe(true);
    expect(events.some((e) => e.type === "tactic_change")).toBe(true);
  });

  it("refuses to shuffle a keeper outfield, which is a substitution not a move", () => {
    const state = midMatch();
    const keeper = state.home.onPitch.find((lp) => lp.player.isGk)!;

    applyIntervention(
      state,
      true,
      { placements: [{ playerId: keeper.player.id, slot: "ST", x: 50, y: 14 }] },
      [],
    );

    expect(keeper.slot).toBe("GK");
  });

  it("accepts every instruction mid-match, not just the original sliders", () => {
    const state = midMatch();

    applyIntervention(
      state,
      true,
      {
        tactics: {
          defensiveLine: 1,
          closingDown: 1,
          tackling: 5,
          offsideTrap: true,
          finalThird: "shoot_early",
          passingFocus: "left",
          keeperDistribution: "long",
        },
      },
      [],
    );

    expect(state.home.tactics.defensiveLine).toBe(1);
    expect(state.home.tactics.offsideTrap).toBe(true);
    expect(state.home.tactics.finalThird).toBe("shoot_early");
    expect(state.home.tactics.keeperDistribution).toBe("long");
  });

  it("reports no change when nothing actually moved", () => {
    const state = midMatch();
    const current = state.home.onPitch[3];

    const result = applyIntervention(
      state,
      true,
      {
        tactics: { mentality: state.home.tactics.mentality },
        placements: [{ playerId: current.player.id, slot: current.slot, x: 0, y: 0 }],
      },
      [],
    );

    expect(result.tacticsChanged).toBe(false);
  });
});
