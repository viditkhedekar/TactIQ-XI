import { describe, it, expect } from "vitest";
import { createMatchState, simulateToEnd } from "../match";
import { analyseMatch, type MatchAnalysis } from "../analysis";
import { aiMinuteHook } from "../aiManager";
import { makeSide, resetPlayerIds } from "./factories";
import { FOCUS_ATTRIBUTES } from "../training";

function analyse(seed: number, homeLevel = 80, awayLevel = 74, clubId = 1): MatchAnalysis {
  resetPlayerIds();
  const home = makeSide({ clubId: 1, clubName: "Arsenal", level: homeLevel, isHome: true });
  const away = makeSide({ clubId: 2, clubName: "Everton", level: awayLevel, isHome: false });
  const state = createMatchState("fixture-1", seed, home, away);
  const events = simulateToEnd(state, aiMinuteHook);
  return analyseMatch(state, events, clubId);
}

describe("analyseMatch", () => {
  it("reports the match from the requested club's side", () => {
    const ours = analyse(11, 80, 74, 1);
    const theirs = analyse(11, 80, 74, 2);

    expect(ours.clubName).toBe("Arsenal");
    expect(theirs.clubName).toBe("Everton");
    expect(ours.goalsFor).toBe(theirs.goalsAgainst);
    expect(ours.goalsAgainst).toBe(theirs.goalsFor);
    expect(ours.isHome).toBe(true);
    expect(theirs.isHome).toBe(false);
  });

  it("calls the result correctly", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const a = analyse(seed);
      const expected =
        a.goalsFor > a.goalsAgainst ? "win" : a.goalsFor === a.goalsAgainst ? "draw" : "loss";
      expect(a.result).toBe(expected);
    }
  });

  it("rates everyone who played and nobody who did not", () => {
    const a = analyse(20);
    expect(a.players.length).toBeGreaterThan(21);
    for (const p of a.players) {
      expect(p.minutes).toBeGreaterThan(0);
      expect(p.rating).toBeGreaterThanOrEqual(4);
      expect(p.rating).toBeLessThanOrEqual(10);
      expect([1, 2]).toContain(p.clubId);
      expect(p.name.length).toBeGreaterThan(0);
    }
  });

  it("orders each side's players by rating", () => {
    const a = analyse(21);
    const ours = a.players.filter((p) => p.clubId === a.clubId);
    for (let i = 1; i < ours.length; i++) {
      expect(ours[i - 1].rating).toBeGreaterThanOrEqual(ours[i].rating);
    }
  });

  it("gives the award to the best rated player who was on long enough", () => {
    const a = analyse(22);
    const motm = a.players.find((p) => p.playerId === a.manOfTheMatchId);
    expect(motm).toBeDefined();
    expect(motm!.minutes).toBeGreaterThanOrEqual(25);

    for (const p of a.players) {
      if (p.minutes >= 25) expect(p.rating).toBeLessThanOrEqual(motm!.rating);
    }
    expect(motm!.standout).toBe("motm");
  });

  it("scores every area and gives each one a readable note", () => {
    const a = analyse(23);
    expect(a.areas).toHaveLength(9);

    for (const area of a.areas) {
      expect(area.score).toBeGreaterThanOrEqual(0);
      expect(area.score).toBeLessThanOrEqual(100);
      expect(area.note.length).toBeGreaterThan(10);
      expect(area.note).not.toMatch(/undefined|NaN|\{|\}/);
      // "1 goals" and "2 goal" both read as bugs to anyone looking at them.
      expect(area.note).not.toMatch(/\b1 (goals|shots|saves|fouls|bookings)\b/);
      expect(area.note).not.toMatch(/\b([02-9]|\d\d+) (goal|shot|save|foul|booking)\b/);
    }
  });

  it("always finds something to train, even after a comfortable win", () => {
    for (const seed of [1, 5, 9, 30, 44, 61]) {
      const a = analyse(seed, 88, 62);
      expect(a.recommendedTraining.length).toBeGreaterThan(0);
      for (const rec of a.recommendedTraining) {
        expect(rec.focus in FOCUS_ATTRIBUTES).toBe(true);
        expect(rec.reason.length).toBeGreaterThan(10);
      }
    }
  });

  it("never suggests the same training twice in one report", () => {
    for (const seed of [2, 12, 22, 32]) {
      const a = analyse(seed);
      const focuses = a.recommendedTraining.map((r) => r.focus);
      expect(new Set(focuses).size).toBe(focuses.length);
      expect(focuses.length).toBeLessThanOrEqual(3);
    }
  });

  it("notices a defence that was overrun", () => {
    // A weak side against a strong one should be told about its defending
    // rather than congratulated on it.
    let flagged = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const a = analyse(seed, 90, 58, 2);
      const defence = a.areas.find((x) => x.key === "defence")!;
      if (defence.score < 50) flagged++;
    }
    expect(flagged).toBeGreaterThan(6);
  });

  it("credits a side that kept a clean sheet", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const a = analyse(seed, 88, 60);
      if (a.goalsAgainst !== 0) continue;
      const gk = a.areas.find((x) => x.key === "goalkeeping")!;
      expect(gk.note).toContain("clean sheet");
      expect(gk.score).toBeGreaterThan(50);
    }
  });

  it("only names players in individual work who actually struggled", () => {
    for (const seed of [3, 13, 23, 33, 43]) {
      const a = analyse(seed);
      const ourIds = new Set(a.players.filter((p) => p.clubId === a.clubId).map((p) => p.playerId));

      for (const item of a.individualWork) {
        // Never single out an opponent, and never someone who played well.
        expect(ourIds.has(item.playerId)).toBe(true);
        const player = a.players.find((p) => p.playerId === item.playerId)!;
        expect(player.standout).toBe("poor");
        expect(item.focus in FOCUS_ATTRIBUTES).toBe(true);
      }
      expect(a.individualWork.length).toBeLessThanOrEqual(4);
    }
  });

  it("tells a player who was sent off to work on his discipline", () => {
    let checked = 0;
    for (let seed = 0; seed < 120 && checked < 3; seed++) {
      const a = analyse(seed);
      const dismissed = a.players.find((p) => p.sentOff && p.clubId === a.clubId);
      if (!dismissed) continue;

      const advice = a.individualWork.find((i) => i.playerId === dismissed.playerId);
      if (!advice) continue;
      expect(advice.focus).toBe("discipline");
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("writes a headline that names the opponent and the score", () => {
    for (const seed of [1, 2, 3, 4]) {
      const a = analyse(seed);
      expect(a.headline).toContain("Everton");
      expect(a.headline).toContain(`${a.goalsFor}-${a.goalsAgainst}`);
      expect(a.headline).not.toContain("—");
    }
  });

  it("keeps positives and concerns from overlapping", () => {
    for (const seed of [1, 7, 14, 28]) {
      const a = analyse(seed);
      for (const positive of a.positives) expect(a.concerns).not.toContain(positive);
    }
  });

  it("is deterministic for a given match", () => {
    expect(JSON.stringify(analyse(4242))).toBe(JSON.stringify(analyse(4242)));
  });
});
