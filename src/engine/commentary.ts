/**
 * Commentary lines for the match ticker.
 *
 * The ticker is the whole match experience in V1, so the text has to carry it.
 * Lines are picked from pools by chance type and outcome, with the players who
 * were actually involved dropped in. Selection uses the match RNG, so a replay
 * of the same match produces the same words as well as the same events.
 */

import { pick, type RngState } from "./rng";
import type { ChanceType, InjurySeverity } from "./types";

type Names = {
  /** Player on the ball or taking the action. */
  player: string;
  /** Provider, fouled player, or the substitute coming on. */
  second?: string;
  club: string;
  keeper?: string;
};

const BUILD_UP: Record<ChanceType, string[]> = {
  through_ball: [
    "{player} is slipped in behind",
    "A clever ball releases {player} through the middle",
    "{player} times the run perfectly and is away",
    "The pass splits the defence and {player} is clear",
  ],
  cross: [
    "The ball is swung in towards {player}",
    "{player} rises to meet the cross",
    "A deep cross finds {player} at the far post",
    "It comes in from the flank and {player} attacks it",
  ],
  cut_inside: [
    "{player} cuts inside off the wing",
    "{player} beats his man and works space for the shot",
    "{player} jinks past the challenge and opens up",
    "A drop of the shoulder from {player} and he is through the gap",
  ],
  long_shot: [
    "{player} lets fly from distance",
    "{player} takes aim from outside the box",
    "It drops to {player} twenty five yards out",
    "{player} decides to shoot from range",
  ],
  counter: [
    "They break at pace and {player} carries it forward",
    "A turnover, and {player} is racing at the back line",
    "Three on two on the counter, {player} leading it",
    "{player} springs the counter after winning it back",
  ],
  set_piece: [
    "The set piece is delivered and {player} gets on the end of it",
    "{player} meets it from the corner",
    "It falls to {player} from the free kick",
    "The delivery picks out {player} in the crowd",
  ],
  penalty: ["{player} steps up to take it"],
};

const GOAL: string[] = [
  "and it is in the back of the net. {player} scores for {club}",
  "GOAL. {player} finishes it off for {club}",
  "he buries it. {player} makes it count for {club}",
  "no mistake from {player}. {club} have their goal",
  "the finish is emphatic. {player} scores",
];

const GOAL_WITH_ASSIST: string[] = [
  "and it is in. {player} scores, teed up by {second}",
  "GOAL for {club}. {second} with the assist, {player} with the finish",
  "{second} picks him out and {player} does the rest",
  "clinical from {player} after fine work by {second}",
];

const SAVE: string[] = [
  "but {keeper} gets down well to save",
  "and {keeper} turns it away",
  "{keeper} is equal to it",
  "a strong hand from {keeper} keeps it out",
  "{keeper} parries it clear",
];

const SHOT_OFF: string[] = [
  "but it flies over the bar",
  "and it drifts wide of the post",
  "he drags it wide",
  "but the effort is off target",
  "and it whistles past the upright",
];

const SHOT_BLOCKED: string[] = [
  "but the shot is blocked",
  "and a defender throws himself in front of it",
  "blocked at the near post",
  "but the block comes in bravely",
];

const FOUL: string[] = [
  "{player} pulls back {second} and concedes the free kick",
  "A clumsy challenge from {player} on {second}",
  "{player} catches {second} late",
  "The whistle goes, {player} the offender",
];

const YELLOW: string[] = [
  "{player} goes into the book",
  "A yellow card for {player}",
  "The referee shows {player} a yellow",
  "{player} is booked for that",
];

const SECOND_YELLOW: string[] = [
  "A second yellow, and {player} is off. {club} are down to ten",
  "That is two bookings for {player}. He has to go",
  "{player} sees red for a second bookable offence",
];

const RED: string[] = [
  "and that is a straight red for {player}. {club} are down to ten",
  "The referee has no hesitation. {player} is sent off",
  "A dreadful challenge from {player} and he is dismissed",
];

const PENALTY_AWARDED: string[] = [
  "Penalty to {club}. {second} is brought down by {player}",
  "The referee points to the spot. A penalty for {club}",
  "{player} brings him down inside the area and it is a penalty",
];

const PENALTY_MISSED: string[] = [
  "but {keeper} saves it. What a moment",
  "and he puts it wide. A huge miss from {player}",
  "{keeper} guesses right and keeps it out",
];

const INJURY: Record<InjurySeverity, string[]> = {
  knock: [
    "{player} takes a knock but carries on",
    "{player} is down briefly, though he waves the physio away",
    "A heavy challenge leaves {player} limping, but he continues",
  ],
  minor: [
    "{player} pulls up and cannot continue",
    "{player} signals to the bench. He has to come off",
    "Trouble for {player}, who is down and calling for treatment",
  ],
  moderate: [
    "{player} is down and this looks sore. He will not continue",
    "The physio is on for {player}, and it does not look good",
    "{player} limps off, clearly in discomfort",
  ],
  severe: [
    "{player} is down badly and the stretcher is coming on",
    "This looks serious for {player}. A long stoppage",
    "Awful news for {club}. {player} goes off holding his hamstring",
  ],
};

const SUB: string[] = [
  "{second} replaces {player} for {club}",
  "A change for {club}: {second} on, {player} off",
  "{club} go to the bench. {player} makes way for {second}",
];

const CORNER_NOTE = "The corner comes to nothing";

function fill(template: string, names: Names): string {
  return template
    .replace(/\{player\}/g, names.player)
    .replace(/\{second\}/g, names.second ?? "a teammate")
    .replace(/\{club\}/g, names.club)
    .replace(/\{keeper\}/g, names.keeper ?? "the keeper");
}

/** Opening build-up phrase for a chance, before the outcome is known. */
export function buildUpLine(rng: RngState, chanceType: ChanceType, names: Names): string {
  return fill(pick(rng, BUILD_UP[chanceType]), names);
}

export function goalLine(rng: RngState, names: Names, hasAssist: boolean): string {
  return fill(pick(rng, hasAssist ? GOAL_WITH_ASSIST : GOAL), names);
}

export function saveLine(rng: RngState, names: Names): string {
  return fill(pick(rng, SAVE), names);
}

export function shotOffLine(rng: RngState, names: Names): string {
  return fill(pick(rng, SHOT_OFF), names);
}

export function shotBlockedLine(rng: RngState, names: Names): string {
  return fill(pick(rng, SHOT_BLOCKED), names);
}

export function foulLine(rng: RngState, names: Names): string {
  return fill(pick(rng, FOUL), names);
}

export function yellowLine(rng: RngState, names: Names): string {
  return fill(pick(rng, YELLOW), names);
}

export function redLine(rng: RngState, names: Names, secondYellow: boolean): string {
  return fill(pick(rng, secondYellow ? SECOND_YELLOW : RED), names);
}

export function penaltyAwardedLine(rng: RngState, names: Names): string {
  return fill(pick(rng, PENALTY_AWARDED), names);
}

export function penaltyMissedLine(rng: RngState, names: Names): string {
  return fill(pick(rng, PENALTY_MISSED), names);
}

export function injuryLine(rng: RngState, severity: InjurySeverity, names: Names): string {
  return fill(pick(rng, INJURY[severity]), names);
}

export function subLine(rng: RngState, names: Names): string {
  return fill(pick(rng, SUB), names);
}

export function cornerLine(): string {
  return CORNER_NOTE;
}

/**
 * Joins a build-up phrase to its outcome so the ticker reads as one sentence
 * rather than two disconnected fragments.
 */
export function joinPhrases(buildUp: string, outcome: string): string {
  const connector = outcome.startsWith("and ") || outcome.startsWith("but ") ? ", " : ". ";
  return `${buildUp}${connector}${outcome}`;
}

export function kickoffLine(homeClub: string, awayClub: string): string {
  return `We are under way. ${homeClub} against ${awayClub}`;
}

export function halfTimeLine(homeClub: string, home: number, awayClub: string, away: number): string {
  return `Half time. ${homeClub} ${home}, ${awayClub} ${away}`;
}

export function fullTimeLine(homeClub: string, home: number, awayClub: string, away: number): string {
  if (home === away) return `Full time. It finishes level, ${homeClub} ${home} ${awayClub} ${away}`;
  const winner = home > away ? homeClub : awayClub;
  return `Full time. ${homeClub} ${home}, ${awayClub} ${away}. ${winner} take it`;
}

export function tacticChangeLine(club: string): string {
  return `${club} adjust their shape and instructions`;
}
