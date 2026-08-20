import { describe, expect, it } from "vitest";
import {
  BOARD,
  assessBoard,
  evaluateFundsRequest,
  evaluateSellRequest,
  expectationFromStrength,
  ordinal,
  shouldSack,
  type SeasonProgress,
} from "../board";

/** A mid-table season going exactly to plan, for tests to vary one field of. */
function progress(overrides: Partial<SeasonProgress> = {}): SeasonProgress {
  return {
    position: 10,
    expectedPosition: 10,
    clubCount: 20,
    played: 19,
    totalRounds: 38,
    cupRoundsWon: 2,
    cupTotalRounds: 5,
    cupWon: false,
    cupGiantKilled: false,
    budgetRemaining: 0.5,
    wagesWithinBudget: true,
    signingRating: 6.8,
    youthMinuteShare: 0.1,
    goalsPerGame: 1.4,
    ...overrides,
  };
}

describe("expectations", () => {
  it("ranks the strongest squad first", () => {
    const all = [84, 80, 76, 72, 68];
    expect(expectationFromStrength(84, all)).toBe(1);
    expect(expectationFromStrength(68, all)).toBe(5);
  });

  it("puts a mid-strength squad mid-table", () => {
    const all = [84, 80, 76, 72, 68];
    expect(expectationFromStrength(76, all)).toBe(3);
  });

  it("handles a squad stronger than anything else in the division", () => {
    expect(expectationFromStrength(99, [84, 80, 76])).toBe(1);
  });
});

describe("ordinals", () => {
  it("uses the right suffix", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(4)).toBe("4th");
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(13)).toBe("13th");
    expect(ordinal(21)).toBe("21st");
  });
});

describe("confidence", () => {
  it("rates beating expectation above missing it", () => {
    const over = assessBoard(progress({ position: 4 }), 65, 0);
    const under = assessBoard(progress({ position: 17 }), 65, 0);
    expect(over.confidence).toBeGreaterThan(under.confidence);
  });

  it("judges the same position differently against different expectations", () => {
    const forATitleClub = assessBoard(progress({ position: 7, expectedPosition: 1 }), 65, 0);
    const forAStruggler = assessBoard(progress({ position: 7, expectedPosition: 17 }), 65, 0);
    expect(forAStruggler.confidence).toBeGreaterThan(forATitleClub.confidence);
  });

  it("always reports all four areas with a readable note", () => {
    const view = assessBoard(progress(), 65, 0);
    expect(view.areas).toHaveLength(4);
    for (const area of view.areas) {
      expect(area.score).toBeGreaterThanOrEqual(0);
      expect(area.score).toBeLessThanOrEqual(100);
      expect(area.note.length).toBeGreaterThan(10);
      expect(area.note).not.toContain("undefined");
      expect(area.note).not.toContain("NaN");
    }
  });

  it("moves gradually rather than jumping to the new figure", () => {
    // A disastrous season assessed from a high starting point should fall, but
    // nowhere near all the way in one round.
    const view = assessBoard(progress({ position: 20, expectedPosition: 2 }), 90, 0);
    expect(view.confidence).toBeLessThan(90);
    expect(view.confidence).toBeGreaterThan(60);
  });

  it("moves less early in a season than late", () => {
    const early = assessBoard(progress({ position: 20, expectedPosition: 2, played: 2 }), 80, 0);
    const late = assessBoard(progress({ position: 20, expectedPosition: 2, played: 30 }), 80, 0);
    expect(late.confidence).toBeLessThan(early.confidence);
  });

  it("treats winning the cup as unarguable", () => {
    const view = assessBoard(progress({ cupWon: true }), 65, 0);
    const cup = view.areas.find((a) => a.key === "cup");
    expect(cup?.score).toBe(100);
  });

  it("punishes going out to a smaller club", () => {
    const normal = assessBoard(progress({ cupRoundsWon: 1 }), 65, 0);
    const humbled = assessBoard(progress({ cupRoundsWon: 1, cupGiantKilled: true }), 65, 0);
    const a = normal.areas.find((x) => x.key === "cup")!.score;
    const b = humbled.areas.find((x) => x.key === "cup")!.score;
    expect(b).toBeLessThan(a);
  });

  it("marks down an overspent wage bill", () => {
    const fine = assessBoard(progress(), 65, 0);
    const over = assessBoard(progress({ wagesWithinBudget: false }), 65, 0);
    const a = fine.areas.find((x) => x.key === "finance")!.score;
    const b = over.areas.find((x) => x.key === "finance")!.score;
    expect(b).toBeLessThan(a);
  });

  it("rewards signings who play well over signings who do not", () => {
    const good = assessBoard(progress({ signingRating: 7.6 }), 65, 0);
    const bad = assessBoard(progress({ signingRating: 5.9 }), 65, 0);
    const a = good.areas.find((x) => x.key === "finance")!.score;
    const b = bad.areas.find((x) => x.key === "finance")!.score;
    expect(a).toBeGreaterThan(b);
  });

  it("notices when young players never play", () => {
    const view = assessBoard(progress({ youthMinuteShare: 0 }), 65, 0);
    const squad = view.areas.find((x) => x.key === "squad")!;
    expect(squad.note).toContain("young");
  });

  it("stays inside its bounds however extreme the season", () => {
    const best = assessBoard(
      progress({ position: 1, expectedPosition: 20, cupWon: true, signingRating: 9 }),
      100,
      0,
    );
    const worst = assessBoard(
      progress({
        position: 20,
        expectedPosition: 1,
        cupRoundsWon: 0,
        cupGiantKilled: true,
        wagesWithinBudget: false,
        signingRating: 4,
        youthMinuteShare: 0,
        goalsPerGame: 0.2,
      }),
      0,
      0,
    );
    expect(best.confidence).toBeLessThanOrEqual(100);
    expect(worst.confidence).toBeGreaterThanOrEqual(0);
  });
});

describe("sacking", () => {
  it("does not sack on one bad round", () => {
    expect(shouldSack(10, 1)).toBe(false);
  });

  it("sacks after a sustained run below the threshold", () => {
    expect(shouldSack(10, BOARD.roundsBeforeSacking)).toBe(true);
  });

  it("does not sack a manager above the threshold, however long it has been", () => {
    expect(shouldSack(BOARD.sackThreshold + 1, 40)).toBe(false);
  });

  it("sacks on relegation regardless of confidence", () => {
    expect(shouldSack(95, 0, { relegated: true })).toBe(true);
  });
});

describe("board requests", () => {
  it("refuses money to a manager under threat", () => {
    const verdict = evaluateFundsRequest("transfer_funds", 10_000_000, 20, 50_000_000, 0);
    expect(verdict.outcome).toBe("refused");
    expect(verdict.grantedEur).toBe(0);
  });

  it("grants a modest ask to a trusted manager", () => {
    const verdict = evaluateFundsRequest("transfer_funds", 5_000_000, 85, 50_000_000, 0);
    expect(verdict.outcome).toBe("granted");
    expect(verdict.grantedEur).toBe(5_000_000);
  });

  it("part-funds an ask beyond what the club can release", () => {
    const verdict = evaluateFundsRequest("transfer_funds", 90_000_000, 70, 30_000_000, 0);
    expect(verdict.outcome).toBe("partial");
    expect(verdict.grantedEur).toBeGreaterThan(0);
    expect(verdict.grantedEur).toBeLessThan(90_000_000);
  });

  it("stops taking the meeting after two asks in a season", () => {
    const verdict = evaluateFundsRequest("transfer_funds", 1_000_000, 90, 50_000_000, 2);
    expect(verdict.outcome).toBe("refused");
  });

  it("never grants more than was asked for", () => {
    const verdict = evaluateFundsRequest("wage_room", 1_000, 100, 90_000_000, 0);
    expect(verdict.grantedEur).toBeLessThanOrEqual(1_000);
  });

  it("refuses to list a key player for a manager they do not rate", () => {
    expect(evaluateSellRequest("Saka", true, 30).outcome).toBe("refused");
  });

  it("lists a key player for a manager they do rate", () => {
    expect(evaluateSellRequest("Saka", true, 80).outcome).toBe("granted");
  });

  it("always lists a squad player", () => {
    expect(evaluateSellRequest("Reserve", false, 10).outcome).toBe("granted");
  });

  it("names the player in its answer", () => {
    expect(evaluateSellRequest("Havertz", false, 60).response).toContain("Havertz");
  });
});
