/**
 * Where each slot sits on the pitch graphic.
 *
 * Positions are percentages: x runs left to right across the pitch, y runs
 * from the manager's own goal (100) up to the opposition goal (0). Keeping
 * this as data rather than per-formation markup means adding a formation is a
 * matter of listing its slots and their coordinates.
 */

import type { FormationName, Slot } from "@/engine";

export type SlotPosition = { slot: Slot; x: number; y: number };

export const FORMATION_LAYOUT: Record<FormationName, SlotPosition[]> = {
  "4-4-2": [
    { slot: "GK", x: 50, y: 92 },
    { slot: "LB", x: 15, y: 72 },
    { slot: "LCB", x: 38, y: 76 },
    { slot: "RCB", x: 62, y: 76 },
    { slot: "RB", x: 85, y: 72 },
    { slot: "LM", x: 15, y: 47 },
    { slot: "LCM", x: 38, y: 50 },
    { slot: "RCM", x: 62, y: 50 },
    { slot: "RM", x: 85, y: 47 },
    { slot: "LST", x: 38, y: 20 },
    { slot: "RST", x: 62, y: 20 },
  ],
  "4-3-3": [
    { slot: "GK", x: 50, y: 92 },
    { slot: "LB", x: 15, y: 72 },
    { slot: "LCB", x: 38, y: 76 },
    { slot: "RCB", x: 62, y: 76 },
    { slot: "RB", x: 85, y: 72 },
    { slot: "CDM", x: 50, y: 58 },
    { slot: "LCM", x: 32, y: 45 },
    { slot: "RCM", x: 68, y: 45 },
    { slot: "LW", x: 15, y: 22 },
    { slot: "ST", x: 50, y: 16 },
    { slot: "RW", x: 85, y: 22 },
  ],
  "4-2-3-1": [
    { slot: "GK", x: 50, y: 92 },
    { slot: "LB", x: 15, y: 72 },
    { slot: "LCB", x: 38, y: 76 },
    { slot: "RCB", x: 62, y: 76 },
    { slot: "RB", x: 85, y: 72 },
    { slot: "LCM", x: 37, y: 57 },
    { slot: "RCM", x: 63, y: 57 },
    { slot: "LW", x: 15, y: 33 },
    { slot: "CAM", x: 50, y: 36 },
    { slot: "RW", x: 85, y: 33 },
    { slot: "ST", x: 50, y: 14 },
  ],
  "3-5-2": [
    { slot: "GK", x: 50, y: 92 },
    { slot: "LCB", x: 28, y: 76 },
    { slot: "CB", x: 50, y: 79 },
    { slot: "RCB", x: 72, y: 76 },
    { slot: "LWB", x: 10, y: 52 },
    { slot: "LCM", x: 32, y: 52 },
    { slot: "CM", x: 50, y: 56 },
    { slot: "RCM", x: 68, y: 52 },
    { slot: "RWB", x: 90, y: 52 },
    { slot: "LST", x: 38, y: 19 },
    { slot: "RST", x: 62, y: 19 },
  ],
  "5-4-1": [
    { slot: "GK", x: 50, y: 92 },
    { slot: "LWB", x: 10, y: 66 },
    { slot: "LCB", x: 30, y: 78 },
    { slot: "CB", x: 50, y: 81 },
    { slot: "RCB", x: 70, y: 78 },
    { slot: "RWB", x: 90, y: 66 },
    { slot: "LM", x: 18, y: 45 },
    { slot: "LCM", x: 39, y: 48 },
    { slot: "RCM", x: 61, y: 48 },
    { slot: "RM", x: 82, y: 45 },
    { slot: "ST", x: 50, y: 17 },
  ],
  "4-1-4-1": [
    { slot: "GK", x: 50, y: 92 },
    { slot: "LB", x: 15, y: 72 },
    { slot: "LCB", x: 38, y: 76 },
    { slot: "RCB", x: 62, y: 76 },
    { slot: "RB", x: 85, y: 72 },
    { slot: "CDM", x: 50, y: 60 },
    { slot: "LM", x: 15, y: 40 },
    { slot: "LCM", x: 39, y: 42 },
    { slot: "RCM", x: 61, y: 42 },
    { slot: "RM", x: 85, y: 40 },
    { slot: "ST", x: 50, y: 15 },
  ],
};

/** Human-readable name for a slot, for the pitch labels. */
export const SLOT_LABEL: Record<Slot, string> = {
  GK: "GK",
  LB: "LB",
  LCB: "CB",
  CB: "CB",
  RCB: "CB",
  RB: "RB",
  LWB: "LWB",
  RWB: "RWB",
  CDM: "DM",
  LCM: "CM",
  CM: "CM",
  RCM: "CM",
  CAM: "AM",
  LM: "LM",
  RM: "RM",
  LW: "LW",
  RW: "RW",
  ST: "ST",
  LST: "ST",
  RST: "ST",
};
