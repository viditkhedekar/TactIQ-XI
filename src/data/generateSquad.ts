/**
 * Inventing squads for the clubs outside the top flight.
 *
 * The Premier League squads come from the EA export and are real. Everybody
 * below them has to be made up, and the job here is to make players who behave
 * sensibly in the simulation rather than ones who look plausible on a page: a
 * generated centre back needs real defending numbers and poor finishing, or the
 * engine's position fit and unit ratings will read him as a striker.
 *
 * Everything is derived from a seed built out of the club id, so a given club
 * always produces the exact same squad. That matters more than it sounds: these
 * rows are shared reference data, seeded once by the importer, and a career that
 * loads them months later must see what it saw the first time.
 */

import { createRng, randInt, randNormal, type RngState } from "@/engine/rng";
import { hash32 } from "@/engine/rng";
import type { Position } from "@/engine";

/** The shape the importer writes, matching the `players` table. */
export type GeneratedPlayer = {
  id: number;
  clubId: number;
  shortName: string;
  longName: string;
  positions: Position[];
  isGk: boolean;
  overall: number;
  potential: number;
  age: number;
  valueEur: number;
  wageEur: number;
  jersey: number;
  preferredFoot: string;
  weakFoot: number;
  skillMoves: number;
  nationality: string;
  heightCm: number;
  weightKg: number;
  clubPosition: string | null;

  crossing: number;
  finishing: number;
  headingAccuracy: number;
  shortPassing: number;
  volleys: number;
  dribbling: number;
  curve: number;
  fkAccuracy: number;
  longPassing: number;
  ballControl: number;

  acceleration: number;
  sprintSpeed: number;
  agility: number;
  reactions: number;
  balance: number;
  jumping: number;
  stamina: number;
  strength: number;

  shotPower: number;
  longShots: number;
  aggression: number;
  interceptions: number;
  positioning: number;
  vision: number;
  penalties: number;
  composure: number;

  marking: number;
  standingTackle: number;
  slidingTackle: number;

  gkDiving: number;
  gkHandling: number;
  gkKicking: number;
  gkPositioning: number;
  gkReflexes: number;
  gkSpeed: number;
};

/* ------------------------------------------------------------------- names */

const FIRST_NAMES = [
  "Jack", "Harry", "Callum", "Reece", "Tyler", "Kieran", "Lewis", "Connor",
  "Ryan", "Josh", "Alfie", "Ollie", "Charlie", "Mason", "Jordan", "Liam",
  "Nathan", "Dean", "Scott", "Craig", "Aaron", "Dylan", "Elliot", "Finn",
  "George", "Isaac", "Jamie", "Kyle", "Luke", "Marcus", "Owen", "Ross",
  "Sam", "Theo", "Adam", "Ben", "Danny", "Ethan", "Freddie", "Gary",
  "Idris", "Kwame", "Malik", "Femi", "Rui", "Diego", "Mateo", "Andrei",
  "Stefan", "Niko", "Emil", "Lasse", "Pierre", "Youssef", "Amir", "Karim",
];

const LAST_NAMES = [
  "Whitfield", "Harrow", "Bexley", "Crowther", "Danby", "Ellery", "Fenwick",
  "Garrick", "Halstead", "Inglis", "Jarrold", "Kelsey", "Lomax", "Mowbray",
  "Naylor", "Ogilvy", "Prentice", "Quilter", "Rushton", "Selby", "Thorne",
  "Underhill", "Vance", "Wexford", "Yardley", "Ashcombe", "Birchall",
  "Cardwell", "Denholm", "Eastwood", "Fairbrass", "Grimshaw", "Hollins",
  "Ivory", "Jepson", "Kirkbride", "Langford", "Merrick", "Northcott",
  "Oakden", "Pemberton", "Rathbone", "Standish", "Tarleton", "Verity",
  "Wingate", "Adeyemi", "Boateng", "Cissé", "Diallo", "Nkemelu", "Okonkwo",
  "Sarr", "Traoré", "Bjelica", "Novak", "Petrov", "Rusu", "Varga",
];

const NATIONS = [
  "England", "England", "England", "England", "England", "England",
  "Scotland", "Wales", "Ireland", "Northern Ireland",
  "France", "Spain", "Portugal", "Netherlands", "Denmark", "Sweden",
  "Nigeria", "Ghana", "Senegal", "Ivory Coast", "Serbia", "Poland",
];

/* --------------------------------------------------------------- positions */

/**
 * The squad's shape: how many of each position to make, in the order shirts
 * are handed out. Deliberately a flat list rather than a distribution, because
 * a squad that randomly ends up with one centre back breaks team selection.
 */
const SQUAD_TEMPLATE: Position[] = [
  "GK", "GK", "GK",
  "CB", "CB", "CB", "CB",
  "LB", "LB", "RB", "RB",
  "CDM", "CDM",
  "CM", "CM", "CM",
  "CAM", "CAM",
  "LM", "RM",
  "LW", "RW",
  "ST", "ST", "ST",
];

/** Secondary positions a player of each type plausibly also covers. */
const SECONDARY: Partial<Record<Position, Position[]>> = {
  CB: ["CDM"],
  LB: ["LM", "LWB"],
  RB: ["RM", "RWB"],
  CDM: ["CM", "CB"],
  CM: ["CDM", "CAM"],
  CAM: ["CM", "CF"],
  LM: ["LW", "LB"],
  RM: ["RW", "RB"],
  LW: ["LM", "ST"],
  RW: ["RM", "ST"],
  ST: ["CF"],
};

/**
 * Which attributes matter for each position, as multipliers on the player's
 * overall. Anything not listed is filled in around a mediocre baseline, which
 * is what keeps a generated full back from being a good finisher by accident.
 */
const PROFILES: Record<string, Partial<Record<keyof GeneratedPlayer, number>>> = {
  GK: {
    gkDiving: 1.0, gkHandling: 1.0, gkReflexes: 1.0, gkPositioning: 0.98,
    gkKicking: 0.9, gkSpeed: 0.6, reactions: 0.95, composure: 0.9,
    jumping: 0.85, strength: 0.8,
  },
  CB: {
    marking: 1.0, standingTackle: 1.0, slidingTackle: 0.95, interceptions: 0.98,
    headingAccuracy: 0.95, strength: 0.95, jumping: 0.92, aggression: 0.9,
    positioning: 0.7, composure: 0.85, shortPassing: 0.8, reactions: 0.88,
    finishing: 0.35, dribbling: 0.5, crossing: 0.4, longShots: 0.4,
    acceleration: 0.72, sprintSpeed: 0.75, agility: 0.65,
  },
  LB: {
    marking: 0.9, standingTackle: 0.92, slidingTackle: 0.9, interceptions: 0.88,
    crossing: 0.9, stamina: 0.95, acceleration: 0.9, sprintSpeed: 0.92,
    agility: 0.85, shortPassing: 0.85, dribbling: 0.78, balance: 0.85,
    finishing: 0.4, headingAccuracy: 0.6, strength: 0.75, longShots: 0.5,
  },
  CDM: {
    interceptions: 1.0, standingTackle: 0.96, marking: 0.92, shortPassing: 0.92,
    longPassing: 0.9, stamina: 0.95, strength: 0.88, aggression: 0.9,
    composure: 0.88, vision: 0.82, positioning: 0.75, ballControl: 0.85,
    finishing: 0.45, dribbling: 0.7, acceleration: 0.72, sprintSpeed: 0.72,
  },
  CM: {
    shortPassing: 1.0, longPassing: 0.95, vision: 0.92, ballControl: 0.92,
    stamina: 0.95, composure: 0.88, dribbling: 0.85, interceptions: 0.8,
    standingTackle: 0.78, longShots: 0.78, positioning: 0.75,
    finishing: 0.6, marking: 0.7, headingAccuracy: 0.6,
  },
  CAM: {
    vision: 1.0, shortPassing: 0.98, ballControl: 0.96, dribbling: 0.95,
    curve: 0.9, longShots: 0.88, composure: 0.9, agility: 0.9,
    positioning: 0.88, finishing: 0.8, fkAccuracy: 0.85, penalties: 0.8,
    marking: 0.35, standingTackle: 0.35, strength: 0.65, interceptions: 0.4,
  },
  LM: {
    crossing: 0.98, dribbling: 0.92, acceleration: 0.92, sprintSpeed: 0.92,
    agility: 0.9, stamina: 0.92, shortPassing: 0.85, ballControl: 0.88,
    curve: 0.85, balance: 0.85, finishing: 0.65, longShots: 0.7,
    marking: 0.5, standingTackle: 0.5, strength: 0.65,
  },
  LW: {
    dribbling: 1.0, acceleration: 0.98, sprintSpeed: 0.96, agility: 0.95,
    ballControl: 0.94, crossing: 0.88, finishing: 0.85, curve: 0.85,
    balance: 0.9, positioning: 0.85, shortPassing: 0.82, longShots: 0.78,
    marking: 0.3, standingTackle: 0.3, strength: 0.6, headingAccuracy: 0.5,
  },
  ST: {
    finishing: 1.0, positioning: 0.98, shotPower: 0.94, headingAccuracy: 0.88,
    composure: 0.9, ballControl: 0.88, acceleration: 0.88, sprintSpeed: 0.9,
    strength: 0.85, jumping: 0.85, volleys: 0.88, penalties: 0.85,
    dribbling: 0.82, longShots: 0.8, reactions: 0.92,
    marking: 0.25, standingTackle: 0.25, interceptions: 0.3, crossing: 0.5,
  },
};

/** Positions that share a profile, so the table above stays short. */
const PROFILE_ALIAS: Record<string, string> = {
  RB: "LB", LWB: "LB", RWB: "LB",
  RM: "LM", RW: "LW", CF: "ST",
};

function profileFor(position: Position): Partial<Record<keyof GeneratedPlayer, number>> {
  return PROFILES[PROFILE_ALIAS[position] ?? position] ?? PROFILES.CM;
}

/* ------------------------------------------------------------- generation */

const ATTRIBUTES: (keyof GeneratedPlayer)[] = [
  "crossing", "finishing", "headingAccuracy", "shortPassing", "volleys",
  "dribbling", "curve", "fkAccuracy", "longPassing", "ballControl",
  "acceleration", "sprintSpeed", "agility", "reactions", "balance",
  "jumping", "stamina", "strength",
  "shotPower", "longShots", "aggression", "interceptions", "positioning",
  "vision", "penalties", "composure",
  "marking", "standingTackle", "slidingTackle",
];

const GK_ATTRIBUTES: (keyof GeneratedPlayer)[] = [
  "gkDiving", "gkHandling", "gkKicking", "gkPositioning", "gkReflexes", "gkSpeed",
];

function clampAttr(value: number): number {
  return Math.max(12, Math.min(94, Math.round(value)));
}

/**
 * One player. `overall` is decided by the caller so a squad can be built with a
 * proper spread of a few good players and a long tail, rather than everybody
 * landing on the mean.
 */
function generatePlayer(
  rng: RngState,
  id: number,
  clubId: number,
  position: Position,
  overall: number,
  jersey: number,
): GeneratedPlayer {
  const isGk = position === "GK";
  const profile = profileFor(position);

  const age = randInt(rng, 18, 34);
  // Younger players have somewhere to go; a 33-year-old is what he is.
  const room = age <= 21 ? randInt(rng, 6, 14) : age <= 25 ? randInt(rng, 2, 8) : randInt(rng, 0, 2);
  const potential = Math.min(90, overall + room);

  const first = FIRST_NAMES[randInt(rng, 0, FIRST_NAMES.length - 1)];
  const last = LAST_NAMES[randInt(rng, 0, LAST_NAMES.length - 1)];

  const player = {
    id,
    clubId,
    shortName: `${first[0]}. ${last}`,
    longName: `${first} ${last}`,
    positions: [position, ...(SECONDARY[position] ?? []).slice(0, randInt(rng, 0, 1))],
    isGk,
    overall,
    potential,
    age,
    // Roughly the same curve the real data follows, so these players are priced
    // against the imported ones rather than being suspiciously cheap.
    valueEur: Math.round(Math.pow(Math.max(40, overall) / 10, 4.2) * 900),
    wageEur: Math.round(Math.pow(Math.max(45, overall) / 10, 3.4) * 55),
    jersey,
    preferredFoot: randInt(rng, 1, 4) === 1 ? "Left" : "Right",
    weakFoot: randInt(rng, 2, 4),
    skillMoves: isGk ? 1 : randInt(rng, 2, 4),
    nationality: NATIONS[randInt(rng, 0, NATIONS.length - 1)],
    heightCm: isGk ? randInt(rng, 186, 197) : randInt(rng, 170, 193),
    weightKg: randInt(rng, 65, 88),
    clubPosition: null,
  } as GeneratedPlayer;

  // Outfield attributes. A weighting of 1.0 means "as good as his overall", and
  // the baseline for anything the profile does not list is deliberately below
  // it. Keepers get a much lower baseline: a goalkeeper carrying a striker's
  // finishing would be read as an outfielder by anything that ranks on these.
  const baseline = isGk ? 0.35 : 0.62;
  for (const attribute of ATTRIBUTES) {
    const weight = profile[attribute] ?? baseline;
    (player[attribute] as number) = clampAttr(randNormal(rng, overall * weight, 4));
  }

  // The other way round for the six goalkeeping numbers: they carry a keeper's
  // rating entirely, and sit at zero for everybody else, which is how the
  // importer stores outfielders in the real data.
  for (const attribute of GK_ATTRIBUTES) {
    (player[attribute] as number) = isGk
      ? clampAttr(randNormal(rng, overall * (profile[attribute] ?? 0.9), 3))
      : 0;
  }

  return player;
}

/**
 * A whole squad for one club.
 *
 * `strength` is the average overall of the best sixteen, which is the same
 * measure the rest of the game uses to judge a squad, so a caller can ask for
 * "a 68 squad" and get one.
 */
export function generateSquad(
  clubId: number,
  strength: number,
  spread: number,
  idBase: number,
): GeneratedPlayer[] {
  // Seeded from the club, so this squad is identical every time it is built.
  const rng = createRng(hash32(`squad-${clubId}-${strength}`));

  // A spread of ratings around the target, best first, so the template's first
  // choice at each position tends to be the better one.
  const ratings = SQUAD_TEMPLATE.map((_, index) => {
    // The top of the squad sits above the mean and the tail well below it,
    // which is what makes a first eleven and a bench rather than 25 clones.
    const rank = index / (SQUAD_TEMPLATE.length - 1);
    const target = strength + spread * (0.9 - rank * 2.1);
    return Math.max(38, Math.min(88, Math.round(randNormal(rng, target, 2.2))));
  });

  return SQUAD_TEMPLATE.map((position, index) =>
    generatePlayer(rng, idBase + index, clubId, position, ratings[index], index + 1),
  );
}
