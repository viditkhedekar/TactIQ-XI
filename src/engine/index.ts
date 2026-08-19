/**
 * Public surface of the simulation engine.
 *
 * Everything outside src/engine should import from here rather than reaching
 * into individual modules, so the internals stay free to move around.
 */

export * from "./types";

export { createRng, hash32, type RngState } from "./rng";

export {
  FORMATIONS,
  FORMATION_NAMES,
  DEFAULT_TACTICS,
  isFormationName,
  applyTacticsChange,
} from "./tactics";

export {
  positionFit,
  fitnessMultiplier,
  formMultiplier,
  effectiveness,
  computeTeamRatings,
  squadStrength,
  playerPace,
  type TeamRatings,
} from "./ratings";

export {
  recoverFitness,
  rollInjury,
  forcesSubstitution,
  injuryChancePerMinute,
} from "./fatigue";

export { finalRating, updateForm } from "./playerRating";

export {
  createMatchState,
  simulateSegment,
  simulateToEnd,
  applyIntervention,
  applySubstitution,
  buildMatchResult,
  type Emitter,
} from "./match";

export {
  chooseFormation,
  chooseTactics,
  selectLineup,
  runAiDecisions,
  aiMinuteHook,
  type Availability,
} from "./aiManager";

export {
  generateSchedule,
  fixturesForRound,
  roundDate,
  ROUNDS_IN_SEASON,
  DEFAULT_SEASON_START,
  type ScheduledFixture,
} from "./schedule";

export { MATCH, FATIGUE, DISCIPLINE } from "./constants";
