/**
 * Commentary lines for the match ticker.
 *
 * The ticker is the whole match experience, so the text has to carry it. Lines
 * are picked from pools by chance type and outcome, with the players who were
 * actually involved dropped in. Selection uses a supplied RNG, so a replay of
 * the same match produces the same words as well as the same events.
 *
 * Two sorts of line live here. The first describes something that happened in
 * the simulation: a goal, a booking, a substitution. The second is colour, and
 * describes nothing at all: crowd noise, a throw-in, a co-commentator's aside.
 * Colour exists because a match that only speaks when a shot is taken reads as
 * a list rather than a broadcast. It is drawn from a separate RNG stream (see
 * `colourRng` in match.ts) precisely so that adding more of it can never move
 * the simulation's own numbers.
 */

import { pick, type RngState } from "./rng";
import type { ChanceType, InjurySeverity } from "./types";

type Names = {
  /** Player on the ball or taking the action. */
  player: string;
  /** Provider, fouled player, or the substitute coming on. */
  second?: string;
  club: string;
  opponent?: string;
  keeper?: string;
};

/* ------------------------------------------------------------------ build-up */

const BUILD_UP: Record<ChanceType, string[]> = {
  through_ball: [
    "{player} is slipped in behind",
    "A clever ball releases {player} through the middle",
    "{player} times the run perfectly and is away",
    "The pass splits the defence and {player} is clear",
    "The back line steps up a fraction late and {player} is through",
    "{player} peels off the shoulder and takes it in stride",
    "One touch inside, and suddenly {player} has the goal in front of him",
    "{player} is played in with the offside flag staying down",
    "That is a lovely weight of pass, {player} onto it",
    "{player} gets across his marker and into the space",
  ],
  cross: [
    "The ball is swung in towards {player}",
    "{player} rises to meet the cross",
    "A deep cross finds {player} at the far post",
    "It comes in from the flank and {player} attacks it",
    "The delivery is whipped and {player} throws himself at it",
    "{player} loses his man in the six yard box and gets his head to it",
    "It is hung up at the back stick for {player}",
    "{player} arrives late at the near post",
    "A dangerous ball across the face, {player} sliding in",
    "{player} climbs above the full back",
  ],
  cut_inside: [
    "{player} cuts inside off the wing",
    "{player} beats his man and works space for the shot",
    "{player} jinks past the challenge and opens up",
    "A drop of the shoulder from {player} and he is through the gap",
    "{player} rolls his man and shifts it onto his stronger foot",
    "{player} comes in off the touchline looking for the far corner",
    "The full back backs off and {player} takes the invitation",
    "{player} stands him up, goes outside, then inside",
    "{player} skips one challenge and rides a second",
  ],
  long_shot: [
    "{player} lets fly from distance",
    "{player} takes aim from outside the box",
    "It drops to {player} twenty five yards out",
    "{player} decides to shoot from range",
    "It is half cleared and {player} meets it on the volley",
    "{player} has a look up and goes for it",
    "Nobody closes {player} down, and he does not need asking twice",
    "{player} strikes it early from the edge of the D",
    "The ball sits up nicely for {player} on the edge",
  ],
  counter: [
    "They break at pace and {player} carries it forward",
    "A turnover, and {player} is racing at the back line",
    "Three on two on the counter, {player} leading it",
    "{player} springs the counter after winning it back",
    "The corner is cleared and {player} is off up the other end",
    "{player} carries it seventy yards with nobody able to get near him",
    "It breaks open in an instant, {player} driving into the space",
    "Caught upfield, and {player} has acres in front of him",
  ],
  set_piece: [
    "The set piece is delivered and {player} gets on the end of it",
    "{player} meets it from the corner",
    "It falls to {player} from the free kick",
    "The delivery picks out {player} in the crowd",
    "It is worked short and clipped back in, {player} attacking it",
    "{player} gambles at the front post and gets there first",
    "The free kick is dropped onto {player} at the back of the six yard box",
    "Bodies everywhere, and it is {player} who reaches it",
    "{player} peels to the edge of the area as it comes over",
  ],
  penalty: [
    "{player} steps up to take it",
    "{player} places the ball on the spot and takes his time",
    "{player} has the ball, and the whole ground goes quiet",
    "{player} takes it on himself",
  ],
};

/* --------------------------------------------------------------------- goals */

/** Where a goal sits in the match, which is most of what makes it worth saying. */
export type GoalSituation =
  | "opener"
  | "equaliser"
  | "lead_taken"
  | "extends"
  | "consolation";

const GOAL_GENERIC: string[] = [
  "and it is in the back of the net. {player} scores for {club}",
  "GOAL. {player} finishes it off for {club}",
  "he buries it. {player} makes it count for {club}",
  "no mistake from {player}. {club} have their goal",
  "the finish is emphatic. {player} scores",
  "and he tucks it away. {player} again for {club}",
  "{player} makes no mistake from six yards",
  "into the bottom corner. {player} with the finish",
  "he lashes it past the keeper. {player} scores",
  "off the underside of the bar and in. {player} has it",
  "and {player} rolls it in with the outside of his boot",
  "{player} takes one touch and finds the corner",
];

const GOAL_WITH_ASSIST: string[] = [
  "and it is in. {player} scores, teed up by {second}",
  "GOAL for {club}. {second} with the assist, {player} with the finish",
  "{second} picks him out and {player} does the rest",
  "clinical from {player} after fine work by {second}",
  "{second} does everything, {player} only has to apply the touch",
  "the ball from {second} is the goal, really. {player} finishes it",
  "and {player} converts. {second} will take the credit for that pass",
  "{second} sets it, {player} strikes it, {club} lead the way on that move",
];

const GOAL_BY_SITUATION: Record<GoalSituation, string[]> = {
  opener: [
    "and there it is, the breakthrough. {player} for {club}",
    "the deadlock goes. {player} with the first",
    "{player} opens the scoring and {club} are ahead",
    "someone had to, and it is {player}",
  ],
  equaliser: [
    "and {club} are level. {player} with the equaliser",
    "{player} pulls them back. All square again",
    "that is the leveller, and {player} has it",
    "{club} are back in this. {player} scores",
    "the reply is immediate. {player} makes it level",
  ],
  lead_taken: [
    "and {club} lead. {player} turns this around",
    "{player} puts them in front, and the mood in here has changed",
    "in front for the first time, and it is {player}",
    "{player} scores, and {club} have their noses ahead",
  ],
  extends: [
    "and that surely settles it. {player} adds another",
    "{player} makes it more comfortable for {club}",
    "the cushion grows. {player} scores again",
    "{player} pours it on. That is a hard one for {opponent} to take",
    "another for {club}, and {player} is enjoying himself now",
  ],
  consolation: [
    "{player} gets one back, though it may be too late",
    "a goal for {player}. It changes the scoreline more than the game",
    "{player} finds the net, and {club} have something at least",
    "{player} scores, and {club} will wonder what might have been",
  ],
};

/* ------------------------------------------------------------- shot outcomes */

const SAVE: string[] = [
  "but {keeper} gets down well to save",
  "and {keeper} turns it away",
  "{keeper} is equal to it",
  "a strong hand from {keeper} keeps it out",
  "{keeper} parries it clear",
  "but {keeper} reads it the whole way",
  "and {keeper} claws it out of the corner. Terrific save",
  "{keeper} stands tall and blocks it with his legs",
  "{keeper} tips it over at full stretch",
  "the keeper does well. {keeper} smothers it at his near post",
  "but {keeper} pushes it round the post",
  "{keeper} holds it, and does not spill a drop",
];

const SHOT_OFF: string[] = [
  "but it flies over the bar",
  "and it drifts wide of the post",
  "he drags it wide",
  "but the effort is off target",
  "and it whistles past the upright",
  "and he leans back on it. That is into the second tier",
  "but the connection is poor and it dribbles wide",
  "and he snatches at it. Nowhere near",
  "he will be disappointed with that. Wide by some way",
  "but it is scuffed, and the keeper watches it roll past",
  "and it is high and handsome",
  "he gets underneath it and it clears the bar",
];

const SHOT_BLOCKED: string[] = [
  "but the shot is blocked",
  "and a defender throws himself in front of it",
  "blocked at the near post",
  "but the block comes in bravely",
  "and it cannons off a defender and away",
  "there is a body in the way, and it is charged down",
  "but it strikes an outstretched leg and loops behind",
  "and the challenge is perfectly timed. Blocked",
];

const WOODWORK: string[] = [
  "and it comes back off the post. He cannot believe it",
  "off the bar. Inches away for {player}",
  "and it clips the outside of the upright",
  "he strikes the crossbar, and the rebound is hacked clear",
  "off the inside of the post and out. That is desperately unlucky",
  "the woodwork saves {opponent}. {player} holds his head",
  "and it rattles the frame of the goal",
];

const GOAL_LINE_CLEARANCE: string[] = [
  "but {second} gets back to hook it off the line",
  "and it is cleared off the line. {second} with the block",
  "{second} appears from nowhere to clear it",
  "somehow it stays out. {second} scrambles it away",
  "and {second} throws himself across to keep it out",
];

/* -------------------------------------------------------------------- fouls */

const FOUL: string[] = [
  "{player} pulls back {second} and concedes the free kick",
  "A clumsy challenge from {player} on {second}",
  "{player} catches {second} late",
  "The whistle goes, {player} the offender",
  "{player} has a handful of {second} shirt and the referee sees it",
  "{second} is caught by {player}, and the free kick is given against {club}",
  "A trailing leg from {player} brings {second} down",
  "{player} goes through the back of {second}",
  "{player} arrives a fraction late on {second}",
];

const YELLOW: string[] = [
  "{player} goes into the book",
  "A yellow card for {player}",
  "The referee shows {player} a yellow",
  "{player} is booked for that",
  "{player} argues, but the card was coming",
  "That is a caution for {player}, and he will have to be careful now",
  "{player} sees yellow, and he knows it was deserved",
  "The referee has seen enough. {player} is booked",
];

const SECOND_YELLOW: string[] = [
  "A second yellow, and {player} is off. {club} are down to ten",
  "That is two bookings for {player}. He has to go",
  "{player} sees red for a second bookable offence",
  "There is no argument. Two yellows for {player} and {club} lose a man",
];

const RED: string[] = [
  "and that is a straight red for {player}. {club} are down to ten",
  "The referee has no hesitation. {player} is sent off",
  "A dreadful challenge from {player} and he is dismissed",
  "{player} is shown red, and {club} have a mountain in front of them now",
  "That is reckless from {player}, and the referee reaches straight for red",
];

const PENALTY_AWARDED: string[] = [
  "Penalty to {club}. {second} is brought down by {player}",
  "The referee points to the spot. A penalty for {club}",
  "{player} brings him down inside the area and it is a penalty",
  "The arm goes up, then the referee points to the spot. {club} have a penalty",
];

const PENALTY_MISSED: string[] = [
  "but {keeper} saves it. What a moment",
  "and he puts it wide. A huge miss from {player}",
  "{keeper} guesses right and keeps it out",
  "{player} strikes the post from twelve yards. He will not sleep tonight",
  "and {keeper} dives the right way. {player} cannot look",
];

/* ---------------------------------------------------------------- incidents */

const INJURY: Record<InjurySeverity, string[]> = {
  knock: [
    "{player} takes a knock but carries on",
    "{player} is down briefly, though he waves the physio away",
    "A heavy challenge leaves {player} limping, but he continues",
    "{player} shakes out his leg and gets on with it",
    "{player} needs a moment, then jogs back into position",
  ],
  minor: [
    "{player} pulls up and cannot continue",
    "{player} signals to the bench. He has to come off",
    "Trouble for {player}, who is down and calling for treatment",
    "{player} feels something and stops immediately. That is his afternoon over",
  ],
  moderate: [
    "{player} is down and this looks sore. He will not continue",
    "The physio is on for {player}, and it does not look good",
    "{player} limps off, clearly in discomfort",
    "{player} cannot put weight on it. He goes off with an arm round the physio",
  ],
  severe: [
    "{player} is down badly and the stretcher is coming on",
    "This looks serious for {player}. A long stoppage",
    "Awful news for {club}. {player} goes off holding his hamstring",
    "{player} is in real distress, and the whole ground has gone quiet",
  ],
};

const SUB: string[] = [
  "{second} replaces {player} for {club}",
  "A change for {club}: {second} on, {player} off",
  "{club} go to the bench. {player} makes way for {second}",
  "{second} is stripped and ready. {player} comes off to a warm reception",
  "{club} freshen it up, {second} on for {player}",
];

/* ------------------------------------------------------------------- colour */

const OFFSIDE: string[] = [
  "The flag goes up against {player}",
  "{player} thought he was in, but he strayed offside",
  "Offside. {player} was a yard early on that run",
  "{player} is flagged, and it was tight",
  "The linesman's flag cuts that one short. Offside against {player}",
  "{player} is caught by the trap, and {opponent} play on",
];

const VAR_CHECK: string[] = [
  "There is a check going on. The referee has his finger to his ear",
  "They are looking at that one upstairs",
  "A pause while it is checked. The crowd are not enjoying the wait",
  "The check is complete, and it stands",
  "Everyone waits. The referee gets the all clear and points to the centre circle",
];

const CORNER: string[] = [
  "Corner to {club}",
  "{club} win a corner and take their time over it",
  "It deflects behind. Another corner for {club}",
  "{club} have a corner, and the big men are coming up",
  "The corner is claimed comfortably by {keeper}",
  "{club} work the corner short, and it comes to nothing",
  "The corner is cleared as far as the edge, and back it comes",
];

/** General play. None of this changes anything, and that is rather the point. */
const BUILD_PLAY: string[] = [
  "{club} knock it about across the back four, looking for a way in",
  "{keeper} takes his time over the goal kick",
  "It is a scrappy few minutes, neither side able to keep hold of it",
  "{player} wins a throw deep in the corner",
  "{club} are content to keep the ball for now",
  "A heavy touch from {player} and it runs out for a goal kick",
  "A long ball forward from {keeper} is headed straight back",
  "{player} demands the ball and gets it, then loses it again",
  "There is a shout for handball, but the referee is not interested",
  "{player} steps in front of the pass and starts something the other way",
  "The ball goes out for a throw, and there is a bit of a tussle over who takes it",
  "{club} switch it from one flank to the other, patiently",
  "{player} tries the pass over the top and overhits it badly",
  "A foul in midfield stops what was building",
  "{player} beats one man, then runs into two more",
  "{keeper} comes for a cross and gets nowhere near it, but gets away with it",
  "{club} are camped in the opposition half without doing much with it",
  "{player} clears his lines with a hoof into the stands",
  "Nothing much happening. The ball is going sideways",
  "{player} is late on the halfway line and gets away with it",
  "The referee has a quiet word with {player}",
  "{club} keep possession with twenty passes and end up back with {keeper}",
  "{player} shapes to cross and cuts it back instead. No takers",
  "There is a stoppage while a boot is retied",
];

/**
 * Crowd and momentum. Split by situation, because the same line about a tense
 * ground reads wrong when a side is four up.
 */
const ATMOSPHERE = {
  early: [
    "Plenty of noise in here, and both sides are still feeling their way",
    "A cagey opening. Neither manager wants to lose this in the first quarter",
    "The ground is full and it is loud",
    "It has started at a proper tempo",
  ],
  level: [
    "This is finely balanced, and everyone in here knows it",
    "One goal settles this, and both benches are on their feet",
    "You can feel the tension around the ground",
    "Neither side can find a way through, and the frustration is starting to show",
    "The crowd want more. There is a low grumble every time it goes backwards",
  ],
  narrow_lead: [
    "A single goal in it, and the noise rises every time {club} come forward",
    "{opponent} are pushing bodies forward now, and it is stretching",
    "This is not settled. Not remotely",
    "The home end is anxious. Every clearance gets a cheer",
    "{club} are trying to slow it down, and getting whistled at for it",
  ],
  comfortable: [
    "{club} look thoroughly in control of this",
    "The away end have started singing about something other than the football",
    "There are gaps appearing everywhere now",
    "{opponent} heads have gone. This has the look of a long afternoon for them",
  ],
  late_level: [
    "Into the closing stages and it is still level. Somebody has to blink",
    "The clock is the enemy for both of them now",
    "Every loose ball is being contested like it is the last one",
    "The ground is roaring them forward",
  ],
  late_chasing: [
    "{opponent} throw everyone forward. It is a back three and hope",
    "Time is nearly up, and the passes are getting more desperate",
    "The keeper is being called up for the set piece",
    "{opponent} have run out of ideas and are just launching it",
  ],
  late_leading: [
    "{club} are taking their time over every restart, and the referee has noticed",
    "The crowd are whistling for the final whistle",
    "{club} keep it in the corner and the seconds tick away",
  ],
};

type AtmosphereKey = keyof typeof ATMOSPHERE;

/** A second voice. Analytical rather than excitable, the way a summariser is. */
const PUNDIT: string[] = [
  "The gap between the midfield and the front two is the problem there",
  "Watch the far side. Nobody has picked up the runner all half",
  "That is the third time they have played that same ball, and it has not worked once",
  "The full back is getting no protection at all",
  "You have to admire the shape. It is holding up under a lot of pressure",
  "He wants to be closer to the striker. He is picking it up too deep",
  "Somebody on that bench needs to make a decision fairly soon",
  "They are winning the second balls, and that is why they are on top",
  "The back four keep dropping deeper, and it is inviting trouble",
  "That is a lovely bit of play, whatever comes of it",
  "He has been the best player on the pitch and it has not been close",
  "The press has gone. They are chasing shadows now",
  "It is a good problem to have, but he has two players in the same space",
  "The keeper's distribution has been the outlet all afternoon",
];

/** Touchline reactions. */
const TOUCHLINE: string[] = [
  "The {club} manager is up out of his seat and shouting at the far side",
  "A few words on the touchline between the two benches",
  "The {club} bench are furious about that one",
  "There is movement on the {club} bench. Somebody is warming up",
  "The {club} manager turns away and cannot watch",
  "A clenched fist from the {club} manager. He liked that",
  "The fourth official is having to keep the {club} manager in his area",
];

const HALF_TIME_ANALYSIS = {
  level: [
    "Level at the break, and honours fairly even",
    "Nothing between them at half time, and both managers will find things to fix",
    "Goalless is probably about right on the balance of that half",
  ],
  leading: [
    "{club} take the lead into the break, and deservedly so",
    "{club} are ahead at half time, though {opponent} will feel they are still in it",
    "A lead for {club}, and plenty still to do",
  ],
  trailing: [
    "{club} have some talking to do at the break",
    "{club} go in behind, and it could have been worse",
    "{club} need something different in the second half",
  ],
};

/* ------------------------------------------------------------------ filling */

function fill(template: string, names: Names): string {
  return template
    .replace(/\{player\}/g, names.player)
    .replace(/\{second\}/g, names.second ?? "a teammate")
    .replace(/\{club\}/g, names.club)
    .replace(/\{opponent\}/g, names.opponent ?? "the visitors")
    .replace(/\{keeper\}/g, names.keeper ?? "the keeper");
}

/* ------------------------------------------------------------------- exports */

/** Opening build-up phrase for a chance, before the outcome is known. */
export function buildUpLine(rng: RngState, chanceType: ChanceType, names: Names): string {
  return fill(pick(rng, BUILD_UP[chanceType]), names);
}

/**
 * Works out what a goal means from the score before and after it, so the line
 * can call an equaliser an equaliser.
 */
export function goalSituation(
  goalsForBefore: number,
  goalsAgainst: number,
): GoalSituation {
  const after = goalsForBefore + 1;
  if (goalsForBefore === 0 && goalsAgainst === 0) return "opener";
  if (after === goalsAgainst) return "equaliser";
  if (goalsForBefore < goalsAgainst && after > goalsAgainst) return "lead_taken";
  if (after < goalsAgainst) return "consolation";
  if (after > goalsAgainst + 1) return "extends";
  return "lead_taken";
}

/**
 * A goal.
 *
 * The situational lines are concatenated onto the base pool rather than chosen
 * between with a separate roll, so this takes exactly one draw however it is
 * called. That matters: the match RNG is shared with the simulation, and a
 * second draw here would shift every roll after it and pull the whole engine
 * off its calibration. Widening a pool is free; drawing from it twice is not.
 */
export function goalLine(
  rng: RngState,
  names: Names,
  hasAssist: boolean,
  situation?: GoalSituation,
): string {
  const base = hasAssist ? GOAL_WITH_ASSIST : GOAL_GENERIC;
  const pool = situation ? [...base, ...GOAL_BY_SITUATION[situation]] : base;
  return fill(pick(rng, pool), names);
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

/** A shot that had already missed, relabelled as having struck the frame. */
export function woodworkLine(rng: RngState, names: Names): string {
  return fill(pick(rng, WOODWORK), names);
}

/** A shot that had already been blocked, relabelled as a clearance off the line. */
export function goalLineClearanceLine(rng: RngState, names: Names): string {
  return fill(pick(rng, GOAL_LINE_CLEARANCE), names);
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

export function offsideLine(rng: RngState, names: Names): string {
  return fill(pick(rng, OFFSIDE), names);
}

export function varCheckLine(rng: RngState, names: Names): string {
  return fill(pick(rng, VAR_CHECK), names);
}

export function cornerLine(rng: RngState, names: Names): string {
  return fill(pick(rng, CORNER), names);
}

export function generalPlayLine(rng: RngState, names: Names): string {
  return fill(pick(rng, BUILD_PLAY), names);
}

export function punditLine(rng: RngState, names: Names): string {
  return fill(pick(rng, PUNDIT), names);
}

export function touchlineLine(rng: RngState, names: Names): string {
  return fill(pick(rng, TOUCHLINE), names);
}

/** How the match stands, from the point of view of the side named in `club`. */
export type Situation = {
  minute: number;
  /** Goals for the side the line is about. */
  goalsFor: number;
  goalsAgainst: number;
};

/** Picks the crowd mood that fits the scoreline and the clock. */
export function atmosphereKey({ minute, goalsFor, goalsAgainst }: Situation): AtmosphereKey {
  const margin = goalsFor - goalsAgainst;
  const late = minute >= 75;

  if (late && margin === 0) return "late_level";
  if (late && margin > 0) return "late_leading";
  if (late) return "late_chasing";
  // The opening pool talks about sides feeling their way, which reads wrong
  // once somebody has scored. A goal ends the early period whatever the clock
  // says.
  if (minute <= 20 && margin === 0) return "early";
  if (margin === 0) return "level";
  if (Math.abs(margin) >= 2) return "comfortable";
  return "narrow_lead";
}

export function atmosphereLine(rng: RngState, situation: Situation, names: Names): string {
  return fill(pick(rng, ATMOSPHERE[atmosphereKey(situation)]), names);
}

export function kickoffLine(homeClub: string, awayClub: string): string {
  return `We are under way. ${homeClub} against ${awayClub}`;
}

export function halfTimeLine(homeClub: string, home: number, awayClub: string, away: number): string {
  return `Half time. ${homeClub} ${home}, ${awayClub} ${away}`;
}

/** A summariser's read on the first half, emitted just after the whistle. */
export function halfTimeAnalysisLine(
  rng: RngState,
  names: Names,
  goalsFor: number,
  goalsAgainst: number,
): string {
  const pool =
    goalsFor === goalsAgainst
      ? HALF_TIME_ANALYSIS.level
      : goalsFor > goalsAgainst
        ? HALF_TIME_ANALYSIS.leading
        : HALF_TIME_ANALYSIS.trailing;
  return fill(pick(rng, pool), names);
}

export function fullTimeLine(homeClub: string, home: number, awayClub: string, away: number): string {
  if (home === away) return `Full time. It finishes level, ${homeClub} ${home} ${awayClub} ${away}`;
  const winner = home > away ? homeClub : awayClub;
  return `Full time. ${homeClub} ${home}, ${awayClub} ${away}. ${winner} take it`;
}

export function tacticChangeLine(club: string): string {
  return `${club} adjust their shape and instructions`;
}

/**
 * Joins a build-up phrase to its outcome so the ticker reads as one sentence
 * rather than two disconnected fragments.
 */
export function joinPhrases(buildUp: string, outcome: string): string {
  const connector = outcome.startsWith("and ") || outcome.startsWith("but ") ? ", " : ". ";
  return `${buildUp}${connector}${outcome}`;
}
