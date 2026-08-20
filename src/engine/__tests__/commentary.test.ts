import { describe, it, expect } from "vitest";
import {
  buildUpLine,
  goalLine,
  saveLine,
  shotOffLine,
  foulLine,
  yellowLine,
  redLine,
  penaltyAwardedLine,
  injuryLine,
  subLine,
  joinPhrases,
  kickoffLine,
  halfTimeLine,
  fullTimeLine,
} from "../commentary";
import { createRng } from "../rng";
import type { ChanceType, InjurySeverity } from "../types";

const names = { player: "Saka", second: "Odegaard", club: "Arsenal", keeper: "Pope" };

const CHANCE_TYPES: ChanceType[] = [
  "through_ball",
  "cross",
  "cut_inside",
  "long_shot",
  "counter",
  "set_piece",
  "penalty",
];

describe("commentary", () => {
  it("substitutes every placeholder", () => {
    const rng = createRng(1);
    const lines = [
      goalLine(rng, names, true),
      saveLine(rng, names),
      foulLine(rng, names),
      yellowLine(rng, names),
      redLine(rng, names, false),
      penaltyAwardedLine(rng, names),
      subLine(rng, names),
    ];
    for (const line of lines) {
      expect(line).not.toMatch(/\{|\}/);
      expect(line.length).toBeGreaterThan(5);
    }
  });

  it("covers every chance type without a gap in the pools", () => {
    const rng = createRng(2);
    for (const type of CHANCE_TYPES) {
      for (let i = 0; i < 20; i++) {
        const line = buildUpLine(rng, type, names);
        expect(line).not.toMatch(/\{|\}/);
        expect(line).toContain("Saka");
      }
    }
  });

  it("covers every injury severity", () => {
    const rng = createRng(3);
    const severities: InjurySeverity[] = ["knock", "minor", "moderate", "severe"];
    for (const severity of severities) {
      const line = injuryLine(rng, severity, names);
      expect(line).not.toMatch(/\{|\}/);
      expect(line).toContain("Saka");
    }
  });

  it("falls back gracefully when there is no assister", () => {
    const rng = createRng(4);
    const line = goalLine(rng, { player: "Haaland", club: "Manchester City" }, false);
    expect(line).not.toMatch(/\{|\}/);
    expect(line).not.toContain("undefined");
  });

  it("falls back when no keeper name is supplied", () => {
    const rng = createRng(5);
    const line = saveLine(rng, { player: "Saka", club: "Arsenal" });
    expect(line).not.toContain("undefined");
    expect(line).toContain("keeper");
  });

  it("names the assister when there is one", () => {
    const rng = createRng(6);
    let mentioned = 0;
    for (let i = 0; i < 30; i++) {
      if (goalLine(rng, names, true).includes("Odegaard")) mentioned++;
    }
    expect(mentioned).toBe(30);
  });

  it("distinguishes a second yellow from a straight red", () => {
    const rng = createRng(7);
    const second = redLine(rng, names, true);
    expect(second.toLowerCase()).toMatch(/second|two booking/);
  });

  it("produces varied lines rather than repeating one template", () => {
    const rng = createRng(8);
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) seen.add(shotOffLine(rng, names));
    expect(seen.size).toBeGreaterThan(3);
  });

  it("is deterministic for a given seed", () => {
    const a = createRng(99);
    const b = createRng(99);
    const linesA = Array.from({ length: 20 }, () => goalLine(a, names, false));
    const linesB = Array.from({ length: 20 }, () => goalLine(b, names, false));
    expect(linesA).toEqual(linesB);
  });

  it("joins build-up and outcome into one readable sentence", () => {
    expect(joinPhrases("Saka cuts inside", "and it drifts wide of the post")).toBe(
      "Saka cuts inside, and it drifts wide of the post",
    );
    expect(joinPhrases("Saka cuts inside", "GOAL. Saka scores")).toBe(
      "Saka cuts inside. GOAL. Saka scores",
    );
  });

  it("capitalises an outcome that follows a full stop", () => {
    // Outcome lines are written to follow a comma, so most begin lowercase.
    // Joined with a full stop they have to be lifted, or the ticker reads
    // "he gets his head to it. the keeper does well".
    expect(joinPhrases("Watkins gets his head to it", "the keeper does well")).toBe(
      "Watkins gets his head to it. The keeper does well",
    );
    expect(joinPhrases("Saka shoots", "he buries it")).toBe("Saka shoots. He buries it");
  });

  it("never prints a lowercase letter straight after a full stop", () => {
    const rng = createRng(31);
    const lines: string[] = [];

    for (const type of CHANCE_TYPES) {
      for (let i = 0; i < 12; i++) {
        const buildUp = buildUpLine(rng, type, names);
        for (const outcome of [
          goalLine(rng, names, i % 2 === 0),
          saveLine(rng, names),
          shotOffLine(rng, names),
        ]) {
          lines.push(joinPhrases(buildUp, outcome));
        }
      }
    }

    for (const line of lines) {
      // Allowed: a full stop inside an all-caps shout, or ending the line.
      expect(line).not.toMatch(/\. [a-z]/);
    }
  });

  it("reports the score at the breaks", () => {
    expect(kickoffLine("Arsenal", "Liverpool")).toContain("Arsenal");
    expect(halfTimeLine("Arsenal", 1, "Liverpool", 0)).toContain("1");
    expect(fullTimeLine("Arsenal", 2, "Liverpool", 2)).toContain("level");
    expect(fullTimeLine("Arsenal", 3, "Liverpool", 1)).toContain("Arsenal take it");
    expect(fullTimeLine("Arsenal", 0, "Liverpool", 1)).toContain("Liverpool take it");
  });

  it("uses no em dashes anywhere in the templates", () => {
    const rng = createRng(10);
    const all: string[] = [];
    for (const type of CHANCE_TYPES) {
      for (let i = 0; i < 15; i++) all.push(buildUpLine(rng, type, names));
    }
    for (let i = 0; i < 40; i++) {
      all.push(goalLine(rng, names, i % 2 === 0));
      all.push(saveLine(rng, names));
      all.push(foulLine(rng, names));
      all.push(redLine(rng, names, i % 2 === 0));
      all.push(subLine(rng, names));
      all.push(injuryLine(rng, "severe", names));
    }
    for (const line of all) expect(line).not.toContain("—");
  });
});
