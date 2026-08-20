import { describe, it, expect } from "vitest";
import {
  TRANSFER,
  askingAfterAppetite,
  askingPrice,
  clubTransferAppetite,
  evaluateBid,
  playerWageDemand,
  squadNeed,
  transferValue,
  wageAcceptance,
} from "../transferMarket";
import { createRng } from "../rng";
import { makePlayer, resetPlayerIds } from "./factories";
import type { EnginePlayer, Position } from "../types";

function player(overrides: Partial<EnginePlayer> = {}): EnginePlayer {
  return makePlayer({ positions: ["CM"], ...overrides });
}

/** A squad with a sensible spread of positions, for depth tests. */
function squad(size = 24, level = 75): EnginePlayer[] {
  resetPlayerIds();
  const shape: Position[] = ["GK", "GK", "GK", "CB", "CB", "CB", "CB", "LB", "RB", "LWB", "RWB",
    "CDM", "CDM", "CM", "CM", "CM", "CAM", "LM", "RM", "LW", "RW", "ST", "ST", "CF"];
  return Array.from({ length: size }, (_, i) =>
    makePlayer({ overall: level, positions: [shape[i % shape.length]], isGk: shape[i % shape.length] === "GK" }),
  );
}

const BID_CONTEXT = { sellerSquadSize: 24, buyerSquadSize: 24, buyerBudget: 500_000_000 };

describe("transferValue", () => {
  it("uses the listed value when there is one", () => {
    const p = player({ overall: 80, age: 28, form: 6.5 });
    expect(transferValue(p, 50_000_000, 80)).toBeCloseTo(50_000_000, -5);
  });

  it("invents a value when the data has none, rather than making him free", () => {
    const p = player({ overall: 80, age: 28 });
    expect(transferValue(p, null, 80)).toBeGreaterThan(1_000_000);
    expect(transferValue(p, 0, 80)).toBeGreaterThan(1_000_000);
  });

  it("charges a premium for a young player with room to grow", () => {
    const prospect = player({ overall: 75, age: 20, form: 6.5 });
    const veteran = player({ overall: 75, age: 30, form: 6.5 });
    expect(transferValue(prospect, 30_000_000, 88)).toBeGreaterThan(
      transferValue(veteran, 30_000_000, 88),
    );
  });

  it("moves the price with form", () => {
    const hot = player({ overall: 80, age: 26, form: 8.2 });
    const cold = player({ overall: 80, age: 26, form: 5.0 });
    expect(transferValue(hot, 40_000_000, 82)).toBeGreaterThan(
      transferValue(cold, 40_000_000, 82),
    );
  });
});

describe("askingPrice", () => {
  it("always asks more than the player is worth", () => {
    for (let seed = 0; seed < 50; seed++) {
      const asking = askingPrice(createRng(seed), 40_000_000, 0.5);
      expect(asking).toBeGreaterThan(40_000_000);
    }
  });

  it("costs far more to prise away a key player than a squad man", () => {
    const key = askingPrice(createRng(1), 40_000_000, 1);
    const fringe = askingPrice(createRng(1), 40_000_000, 0);
    expect(key).toBeGreaterThan(fringe * 1.3);
  });

  it("discounts a player the club has no use for", () => {
    const wanted = askingPrice(createRng(2), 20_000_000, 0.05);
    const unwanted = askingPrice(createRng(2), 20_000_000, 0.05, { unwanted: true });
    expect(unwanted).toBeLessThan(wanted);
  });

  it("is stable for a given seed, so a listed price does not flicker", () => {
    expect(askingPrice(createRng(7), 30_000_000, 0.6)).toBe(
      askingPrice(createRng(7), 30_000_000, 0.6),
    );
  });
});

describe("askingAfterAppetite", () => {
  /**
   * This is the bug that made the transfer screen lie: the list showed the raw
   * valuation while the decision was made against the appetite-adjusted one, so
   * bidding exactly what was asked came back as a counter offer.
   */
  it("is the number a bid is actually judged against", () => {
    const asking = 50_000_000;
    for (const appetite of [0, 0.25, 0.5, 0.75, 1]) {
      const quoted = askingAfterAppetite(asking, appetite);
      const verdict = evaluateBid(quoted, asking, { appetite, ...BID_CONTEXT });
      expect(verdict.decision).toBe("accept");
    }
  });

  it("shades the price for a keen seller and raises it for a reluctant one", () => {
    const keen = askingAfterAppetite(50_000_000, 1);
    const reluctant = askingAfterAppetite(50_000_000, 0);
    expect(keen).toBeLessThan(reluctant);
  });

  it("treats an out-of-range appetite as the nearest sane value", () => {
    expect(askingAfterAppetite(10_000_000, 5)).toBe(askingAfterAppetite(10_000_000, 1));
    expect(askingAfterAppetite(10_000_000, -3)).toBe(askingAfterAppetite(10_000_000, 0));
  });
});

describe("evaluateBid", () => {
  it("accepts a bid at or above what they want", () => {
    expect(
      evaluateBid(60_000_000, 50_000_000, { appetite: 0.5, ...BID_CONTEXT }).decision,
    ).toBe("accept");
  });

  it("counters a bid that is close, at a figure between the two", () => {
    const verdict = evaluateBid(44_000_000, 50_000_000, { appetite: 0.5, ...BID_CONTEXT });
    expect(verdict.decision).toBe("counter");
    if (verdict.decision === "counter") {
      expect(verdict.counterFee).toBeGreaterThan(44_000_000);
      expect(verdict.counterFee).toBeLessThanOrEqual(50_000_000);
    }
  });

  it("rejects a lowball outright", () => {
    const verdict = evaluateBid(10_000_000, 50_000_000, { appetite: 0.5, ...BID_CONTEXT });
    expect(verdict.decision).toBe("reject");
  });

  it("refuses a bid the buyer cannot fund", () => {
    const verdict = evaluateBid(60_000_000, 50_000_000, {
      ...BID_CONTEXT,
      buyerBudget: 20_000_000,
    });
    expect(verdict.decision).toBe("reject");
    if (verdict.decision === "reject") expect(verdict.reason).toMatch(/afford/i);
  });

  it("will not let a club sell itself below the minimum squad size", () => {
    const verdict = evaluateBid(999_000_000, 50_000_000, {
      ...BID_CONTEXT,
      sellerSquadSize: TRANSFER.minSquadSize,
    });
    expect(verdict.decision).toBe("reject");
  });

  it("will not let a buyer go past the squad cap", () => {
    const verdict = evaluateBid(999_000_000, 50_000_000, {
      ...BID_CONTEXT,
      buyerSquadSize: TRANSFER.maxSquadSize,
    });
    expect(verdict.decision).toBe("reject");
  });

  it("makes a keen seller easier to deal with than a reluctant one", () => {
    const bid = 47_000_000;
    const keen = evaluateBid(bid, 50_000_000, { appetite: 1, ...BID_CONTEXT });
    const reluctant = evaluateBid(bid, 50_000_000, { appetite: 0, ...BID_CONTEXT });
    expect(keen.decision).toBe("accept");
    expect(reluctant.decision).not.toBe("accept");
  });
});

describe("wages", () => {
  it("wants a rise to join a club at the same level", () => {
    expect(playerWageDemand(100_000, 78, 78)).toBeGreaterThan(100_000);
  });

  it("demands far more to drop down a level", () => {
    const stepDown = playerWageDemand(100_000, 84, 70);
    const sideways = playerWageDemand(100_000, 78, 78);
    expect(stepDown).toBeGreaterThan(sideways);
  });

  it("will take less to join a better side", () => {
    const stepUp = playerWageDemand(100_000, 70, 84);
    const sideways = playerWageDemand(100_000, 78, 78);
    expect(stepUp).toBeLessThan(sideways);
  });

  it("invents a wage rather than working for nothing", () => {
    expect(playerWageDemand(null, 75, 75)).toBeGreaterThan(0);
    expect(playerWageDemand(0, 75, 75)).toBeGreaterThan(0);
  });

  it("signs when the money is there", () => {
    const demand = playerWageDemand(100_000, 78, 78);
    expect(wageAcceptance(demand, demand, 78, 78).decision).toBe("accept");
    expect(wageAcceptance(demand + 1, demand, 78, 78).decision).toBe("accept");
  });

  it("refuses when the money falls short", () => {
    const demand = playerWageDemand(100_000, 78, 78);
    const verdict = wageAcceptance(demand - 1, demand, 78, 78);
    expect(verdict.decision).toBe("reject");
    if (verdict.decision === "reject") expect(verdict.demand).toBe(demand);
  });

  it("refuses a big enough drop in level at any wage at all", () => {
    // Without this a relegation candidate could buy a title winner's midfield
    // simply by paying over the odds.
    const verdict = wageAcceptance(50_000_000, 100_000, 88, 60);
    expect(verdict.decision).toBe("reject");
    if (verdict.decision === "reject") expect(verdict.reason).toMatch(/level/i);
  });
});

describe("squadNeed", () => {
  it("names every group and ranks them worst first", () => {
    const need = squadNeed(squad());
    expect(Object.keys(need.byGroup).sort()).toEqual(["ATT", "DEF", "GK", "MID"]);
    for (let i = 1; i < need.priority.length; i++) {
      expect(need.byGroup[need.priority[i - 1]].shortfall).toBeGreaterThanOrEqual(
        need.byGroup[need.priority[i]].shortfall,
      );
    }
  });

  it("spots the position a squad has nobody in", () => {
    const withoutKeepers = squad().filter((p) => !p.isGk);
    const need = squadNeed(withoutKeepers);
    expect(need.byGroup.GK.count).toBe(0);
    expect(need.priority[0]).toBe("GK");
  });

  it("spots a position that has bodies but not quality", () => {
    resetPlayerIds();
    const strong = Array.from({ length: 18 }, () =>
      makePlayer({ overall: 84, positions: ["CM"] }),
    );
    const weakAttack = Array.from({ length: 6 }, () =>
      makePlayer({ overall: 58, positions: ["ST"] }),
    );
    const need = squadNeed([...strong, ...weakAttack]);
    expect(need.byGroup.ATT.count).toBe(6);
    expect(need.byGroup.ATT.shortfall).toBeGreaterThan(0);
  });

  it("flags a squad that is too small to play and one that is too big", () => {
    expect(squadNeed(squad(15)).mustBuy).toBe(true);
    expect(squadNeed(squad(15)).mustSell).toBe(false);
    expect(squadNeed(squad(TRANSFER.maxSquadSize + 1)).mustSell).toBe(true);
    expect(squadNeed(squad(24)).mustBuy).toBe(false);
    expect(squadNeed(squad(24)).mustSell).toBe(false);
  });

  it("copes with an empty squad rather than dividing by zero", () => {
    const need = squadNeed([]);
    expect(need.mustBuy).toBe(true);
    for (const group of need.priority) {
      expect(Number.isFinite(need.byGroup[group].shortfall)).toBe(true);
    }
  });
});

describe("clubTransferAppetite", () => {
  it("stays within nought and one whatever it is handed", () => {
    for (const size of [10, 18, 24, 30, 40]) {
      for (const budget of [0, 5_000_000, 200_000_000]) {
        const appetite = clubTransferAppetite(squadNeed(squad(size)), budget, size);
        expect(appetite).toBeGreaterThanOrEqual(0);
        expect(appetite).toBeLessThanOrEqual(1);
      }
    }
  });

  it("makes an overloaded squad keener to sell than a threadbare one", () => {
    const bloated = clubTransferAppetite(squadNeed(squad(33)), 50_000_000, 33);
    const threadbare = clubTransferAppetite(squadNeed(squad(17)), 50_000_000, 17);
    expect(bloated).toBeGreaterThan(threadbare);
  });

  it("makes a club with no money readier to listen", () => {
    const broke = clubTransferAppetite(squadNeed(squad(24)), 0, 24);
    const rich = clubTransferAppetite(squadNeed(squad(24)), 200_000_000, 24);
    expect(broke).toBeGreaterThan(rich);
  });
});
