/**
 * The pitch as a place you can put people.
 *
 * There is no formation dropdown. A manager drags the eleven wherever he wants
 * them and the shape is whatever that turns out to be, which is the right way
 * round: a formation is a description of where people are standing, not a thing
 * you choose and then obey.
 *
 * Dragging snaps to an anchor. Each anchor is a recognised role at a particular
 * spot, and the role is the only part the simulation reads: `computeTeamRatings`
 * and `fatigueDrain` work from the slot, never from the coordinates. The
 * coordinates exist so the board can be drawn back exactly as it was arranged,
 * and so two players in the same kind of role can stand in different places.
 *
 * Anchors deliberately outnumber the slots. Three of them are CDM, three are
 * CAM: a manager who wants a midfield three sitting deep can have one, and the
 * engine sees three deep midfielders because that is what he built.
 */


import type { PitchPlacement, Slot } from "./types";

export type PitchAnchor = {
  slot: Slot;
  /** Percent across the pitch: 0 far left, 100 far right. */
  x: number;
  /** Percent up the pitch: 100 own goal, 0 opposition goal. */
  y: number;
};

/**
 * Every spot a player can be dropped on.
 *
 * Laid out as the rows of a team sheet rather than a uniform grid, because an
 * even grid puts anchors in places nobody has ever played and leaves out places
 * everybody does.
 */
export const PITCH_ANCHORS: PitchAnchor[] = [
  { slot: "GK", x: 50, y: 93 },

  // Back line.
  { slot: "LB", x: 12, y: 74 },
  { slot: "LCB", x: 31, y: 78 },
  { slot: "CB", x: 50, y: 80 },
  { slot: "RCB", x: 69, y: 78 },
  { slot: "RB", x: 88, y: 74 },

  // Wing backs, pushed on from the full back positions.
  { slot: "LWB", x: 8, y: 60 },
  { slot: "RWB", x: 92, y: 60 },

  // Holding midfield.
  { slot: "CDM", x: 33, y: 62 },
  { slot: "CDM", x: 50, y: 60 },
  { slot: "CDM", x: 67, y: 62 },

  // Central midfield.
  { slot: "LCM", x: 28, y: 48 },
  { slot: "CM", x: 50, y: 48 },
  { slot: "RCM", x: 72, y: 48 },

  // Wide midfield.
  { slot: "LM", x: 10, y: 45 },
  { slot: "RM", x: 90, y: 45 },

  // Attacking midfield. The wide pair sit level with the central three, which
  // is what lets a front four be built as a band rather than as a staircase.
  { slot: "LW", x: 12, y: 34 },
  { slot: "CAM", x: 31, y: 34 },
  { slot: "CAM", x: 50, y: 34 },
  { slot: "CAM", x: 69, y: 34 },
  { slot: "RW", x: 88, y: 34 },

  // Wingers, high and wide.
  { slot: "LW", x: 9, y: 22 },
  { slot: "RW", x: 91, y: 22 },

  // Forwards.
  { slot: "LST", x: 34, y: 14 },
  { slot: "ST", x: 50, y: 14 },
  { slot: "RST", x: 66, y: 14 },
];

/**
 * The resting place of each slot, for laying out a team sheet that was stored
 * before the board had coordinates. Where a slot has several anchors, the
 * central one wins.
 */
export const SLOT_HOME: Record<Slot, { x: number; y: number }> = (() => {
  const home = {} as Record<Slot, { x: number; y: number }>;
  for (const anchor of PITCH_ANCHORS) {
    const existing = home[anchor.slot];
    // Prefer the anchor nearest the middle, so a shared slot lands centrally.
    if (!existing || Math.abs(anchor.x - 50) < Math.abs(existing.x - 50)) {
      home[anchor.slot] = { x: anchor.x, y: anchor.y };
    }
  }
  return home;
})();

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * The anchor a drop lands on: simply the nearest one.
 *
 * An earlier version tried to be clever and steer drops away from anchors that
 * were already taken, which made the behaviour impossible to predict from where
 * the cursor was. Dropping a player onto a teammate is not a mistake to be
 * routed around, it is a swap, and it is the caller's job to notice the target
 * is occupied and exchange the two. Nearest-anchor is what a manager can
 * actually aim at.
 */
export function snapToAnchor(point: { x: number; y: number }): PitchAnchor {
  let nearest = PITCH_ANCHORS[0];
  let nearestDistance = Infinity;

  for (const anchor of PITCH_ANCHORS) {
    const d = distance(point, anchor);
    if (d < nearestDistance) {
      nearest = anchor;
      nearestDistance = d;
    }
  }

  return nearest;
}

/** The anchor at a placement, if that spot is taken. */
export function anchorAt(
  placements: readonly PitchPlacement[],
  anchor: { x: number; y: number },
): PitchPlacement | null {
  return (
    placements.find((p) => Math.abs(p.x - anchor.x) < 0.5 && Math.abs(p.y - anchor.y) < 0.5) ?? null
  );
}

/** Whether a placement sits on a recognised anchor. */
export function isValidPlacement(placement: { slot: Slot; x: number; y: number }): boolean {
  return PITCH_ANCHORS.some(
    (a) =>
      a.slot === placement.slot &&
      Math.abs(a.x - placement.x) < 0.5 &&
      Math.abs(a.y - placement.y) < 0.5,
  );
}

/* ----------------------------------------------------------- shape reading */

/** Gap in percent up the pitch that separates one band of players from the next. */
const BAND_GAP = 10;

/**
 * Reads the shape back out of the placements, as "4-2-3-1" and the like.
 *
 * The bands are found rather than assumed: the outfield players are sorted from
 * their own goal forwards and a new band starts wherever there is a real gap
 * between them. That is what lets the label describe a shape nobody named, and
 * it means a manager who drags a midfielder ten yards forward sees the number
 * change, which is the feedback that makes free placement legible at all.
 */
export function describeShape(placements: readonly PitchPlacement[]): string {
  const outfield = placements
    .filter((p) => p.slot !== "GK")
    .slice()
    // Own goal first, so the label reads back to front like a formation does.
    .sort((a, b) => b.y - a.y);

  if (outfield.length === 0) return "-";

  const bands: number[] = [];
  let current = 1;

  for (let i = 1; i < outfield.length; i++) {
    if (outfield[i - 1].y - outfield[i].y > BAND_GAP) {
      bands.push(current);
      current = 1;
    } else {
      current++;
    }
  }
  bands.push(current);

  // Nobody writes a formation with six numbers in it. Merge the two adjacent
  // bands that sit closest together until it reads like a formation.
  while (bands.length > 4) {
    let mergeAt = 0;
    let smallest = Infinity;
    for (let i = 0; i < bands.length - 1; i++) {
      const combined = bands[i] + bands[i + 1];
      if (combined < smallest) {
        smallest = combined;
        mergeAt = i;
      }
    }
    bands.splice(mergeAt, 2, bands[mergeAt] + bands[mergeAt + 1]);
  }

  return bands.join("-");
}

/**
 * A starting arrangement built from one of the templates the AI uses.
 *
 * The manager never picks a formation, but a brand new career still has to have
 * the eleven standing somewhere sensible before he opens the board.
 */
export function placementsFromFormation(
  lineup: readonly { playerId: number; slot: Slot }[],
): PitchPlacement[] {
  const used = new Set<string>();

  return lineup.map((entry) => {
    // Where a slot has several anchors, hand out a different one each time so
    // three central midfielders do not all stand on the same blade of grass.
    const candidates = PITCH_ANCHORS.filter((a) => a.slot === entry.slot);
    const free = candidates.find((a) => !used.has(`${a.x}:${a.y}`)) ?? candidates[0];

    if (free) {
      used.add(`${free.x}:${free.y}`);
      return { playerId: entry.playerId, slot: entry.slot, x: free.x, y: free.y };
    }

    const home = SLOT_HOME[entry.slot] ?? { x: 50, y: 50 };
    return { playerId: entry.playerId, slot: entry.slot, x: home.x, y: home.y };
  });
}
