import { describe, it, expect } from "vitest";
import {
  FORMATIONS,
  FORMATION_NAMES,
  isFormationName,
  possessionShare,
  momentRate,
  chanceTypeWeights,
  foulRate,
  fatigueDrain,
  applyTacticsChange,
  DEFAULT_TACTICS,
} from "../tactics";
import type { TeamTactics } from "../types";

const t = (over: Partial<TeamTactics> = {}): TeamTactics => ({ ...DEFAULT_TACTICS, ...over });

describe("formations", () => {
  it("gives every formation exactly eleven slots with one keeper", () => {
    for (const name of FORMATION_NAMES) {
      const slots = FORMATIONS[name];
      expect(slots).toHaveLength(11);
      expect(slots.filter((s) => s === "GK")).toHaveLength(1);
    }
  });

  it("never repeats a slot within a formation", () => {
    for (const name of FORMATION_NAMES) {
      expect(new Set(FORMATIONS[name]).size).toBe(11);
    }
  });

  it("names match the shape they describe", () => {
    // 5-4-1 fields five defenders and a lone striker.
    const back5 = FORMATIONS["5-4-1"].filter((s) => s.includes("CB") || s.includes("WB"));
    expect(back5).toHaveLength(5);
    expect(FORMATIONS["5-4-1"].filter((s) => s.includes("ST"))).toHaveLength(1);
    expect(FORMATIONS["4-4-2"].filter((s) => s.includes("ST"))).toHaveLength(2);
  });

  it("recognises valid formation names and rejects junk", () => {
    expect(isFormationName("4-3-3")).toBe(true);
    expect(isFormationName("9-0-1")).toBe(false);
  });
});

describe("possessionShare", () => {
  it("is close to even for equal sides, with a slight home edge", () => {
    const share = possessionShare(70, 70, t(), t());
    expect(share).toBeGreaterThan(0.5);
    expect(share).toBeLessThan(0.55);
  });

  it("favours the better midfield", () => {
    const strong = possessionShare(80, 60, t(), t());
    const weak = possessionShare(60, 80, t(), t());
    expect(strong).toBeGreaterThan(0.55);
    expect(weak).toBeLessThan(0.45);
  });

  it("gives the ball away when playing fast and direct", () => {
    const patient = possessionShare(70, 70, t({ tempo: 1, directness: 1 }), t());
    const direct = possessionShare(70, 70, t({ tempo: 5, directness: 5 }), t());
    expect(direct).toBeLessThan(patient);
  });

  it("wins the ball back by pressing", () => {
    const standOff = possessionShare(70, 70, t({ pressing: 1 }), t());
    const press = possessionShare(70, 70, t({ pressing: 5 }), t());
    expect(press).toBeGreaterThan(standOff);
  });

  it("stays inside the configured bounds even for absurd mismatches", () => {
    const lopsided = possessionShare(99, 20, t({ pressing: 5 }), t({ pressing: 1 }));
    expect(lopsided).toBeLessThanOrEqual(0.72);
    const reverse = possessionShare(20, 99, t({ pressing: 1 }), t({ pressing: 5 }));
    expect(reverse).toBeGreaterThanOrEqual(0.28);
  });
});

describe("momentRate", () => {
  const attack = { attackCentral: 70, attackWide: 70 };
  const defence = { defence: 70 };

  it("rises with attacking mentality and falls with defensive", () => {
    const defensive = momentRate(attack, defence, t({ mentality: 1 }), t(), true, 0.5);
    const balanced = momentRate(attack, defence, t({ mentality: 3 }), t(), true, 0.5);
    const attacking = momentRate(attack, defence, t({ mentality: 5 }), t(), true, 0.5);
    expect(defensive).toBeLessThan(balanced);
    expect(balanced).toBeLessThan(attacking);
  });

  it("hands the opponent more chances when they attack", () => {
    const vsDefensive = momentRate(attack, defence, t(), t({ mentality: 1 }), true, 0.5);
    const vsAttacking = momentRate(attack, defence, t(), t({ mentality: 5 }), true, 0.5);
    expect(vsAttacking).toBeGreaterThan(vsDefensive);
  });

  it("rewards a better attack against a weaker defence", () => {
    const strong = momentRate({ attackCentral: 85, attackWide: 85 }, { defence: 55 }, t(), t(), true, 0.5);
    const weak = momentRate({ attackCentral: 55, attackWide: 55 }, { defence: 85 }, t(), t(), true, 0.5);
    expect(strong).toBeGreaterThan(weak);
  });

  it("gives the home side a bonus", () => {
    const home = momentRate(attack, defence, t(), t(), true, 0.5);
    const away = momentRate(attack, defence, t(), t(), false, 0.5);
    expect(home).toBeGreaterThan(away);
  });

  it("stays within the clamped range at the extremes", () => {
    const absurd = momentRate(
      { attackCentral: 99, attackWide: 99 },
      { defence: 20 },
      t({ mentality: 5, tempo: 5 }),
      t({ mentality: 5 }),
      true,
      0.72,
    );
    expect(absurd).toBeLessThanOrEqual(1.7);
    expect(absurd).toBeGreaterThanOrEqual(0.55);
  });
});

describe("chanceTypeWeights", () => {
  const ratings = { attackCentral: 70, attackWide: 70 };
  const opponent = { defLinePace: 70 };

  it("turns width into crosses", () => {
    const narrow = chanceTypeWeights(t({ width: 1 }), ratings, opponent);
    const wide = chanceTypeWeights(t({ width: 5 }), ratings, opponent);
    expect(wide.cross).toBeGreaterThan(narrow.cross);
  });

  it("turns directness into balls in behind", () => {
    const patient = chanceTypeWeights(t({ directness: 1 }), ratings, opponent);
    const direct = chanceTypeWeights(t({ directness: 5 }), ratings, opponent);
    expect(direct.through_ball).toBeGreaterThan(patient.through_ball);
    expect(direct.cut_inside).toBeLessThan(patient.cut_inside);
  });

  it("punishes a slow back line with more balls in behind", () => {
    const vsQuick = chanceTypeWeights(t(), ratings, { defLinePace: 90 });
    const vsSlow = chanceTypeWeights(t(), ratings, { defLinePace: 50 });
    expect(vsSlow.through_ball).toBeGreaterThan(vsQuick.through_ball);
  });

  it("leans on the stronger side of the attack", () => {
    const wideTeam = chanceTypeWeights(t(), { attackCentral: 60, attackWide: 85 }, opponent);
    const centralTeam = chanceTypeWeights(t(), { attackCentral: 85, attackWide: 60 }, opponent);
    expect(wideTeam.cross).toBeGreaterThan(centralTeam.cross);
    expect(centralTeam.through_ball).toBeGreaterThan(wideTeam.through_ball);
  });

  it("never produces a zero or negative weight", () => {
    for (const width of [1, 5] as const) {
      for (const directness of [1, 5] as const) {
        const w = chanceTypeWeights(t({ width, directness, mentality: 1 }), ratings, {
          defLinePace: 95,
        });
        for (const value of Object.values(w)) expect(value).toBeGreaterThan(0);
      }
    }
  });
});

describe("foulRate and fatigue", () => {
  it("concedes more fouls when pressing hard", () => {
    expect(foulRate(t({ pressing: 5 }), 60)).toBeGreaterThan(foulRate(t({ pressing: 1 }), 60));
  });

  it("concedes more fouls with an aggressive side", () => {
    expect(foulRate(t(), 85)).toBeGreaterThan(foulRate(t(), 45));
  });

  it("drains wing-backs faster than centre-backs, and keepers barely at all", () => {
    expect(fatigueDrain("LWB", 70, t())).toBeGreaterThan(fatigueDrain("LCB", 70, t()));
    expect(fatigueDrain("GK", 70, t())).toBeLessThan(fatigueDrain("LCB", 70, t()) / 2);
  });

  it("drains low-stamina players faster", () => {
    expect(fatigueDrain("CM", 50, t())).toBeGreaterThan(fatigueDrain("CM", 95, t()));
  });

  it("drains faster at high tempo and high press", () => {
    const relaxed = fatigueDrain("CM", 70, t({ tempo: 1, pressing: 1 }));
    const intense = fatigueDrain("CM", 70, t({ tempo: 5, pressing: 5 }));
    expect(intense).toBeGreaterThan(relaxed * 1.3);
  });

  it("keeps a full match survivable for a fit midfielder", () => {
    // 90 minutes at neutral settings should tire a good player, not destroy them.
    const total = fatigueDrain("CM", 80, t()) * 90;
    expect(total).toBeGreaterThan(20);
    expect(total).toBeLessThan(55);
  });
});

describe("applyTacticsChange", () => {
  it("keeps unspecified fields", () => {
    const out = applyTacticsChange(t({ mentality: 2 }), { pressing: 5 });
    expect(out.mentality).toBe(2);
    expect(out.pressing).toBe(5);
  });

  it("clamps out-of-range values instead of trusting them", () => {
    const out = applyTacticsChange(t(), { mentality: 99, tempo: -4 } as Partial<TeamTactics>);
    expect(out.mentality).toBe(5);
    expect(out.tempo).toBe(1);
  });

  it("ignores an unknown formation", () => {
    const out = applyTacticsChange(t({ formation: "4-3-3" }), {
      formation: "7-1-2" as never,
    });
    expect(out.formation).toBe("4-3-3");
  });

  it("rounds fractional slider values", () => {
    const out = applyTacticsChange(t(), { width: 4.4 as never });
    expect(out.width).toBe(4);
  });
});
