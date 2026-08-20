/**
 * Public surface of the simulation engine.
 *
 * Everything outside src/engine should import from here rather than reaching
 * into individual modules, so the internals stay free to move around.
 */

export * from "./types";

export { createRng, hash32, randInt, shuffle, type RngState } from "./rng";

export {
  FORMATIONS,
  FORMATION_NAMES,
  DEFAULT_TACTICS,
  DEFAULT_SET_PIECES,
  TACTICAL_STYLES,
  TACTICAL_STYLE_NAMES,
  FINAL_THIRD_OPTIONS,
  PASSING_FOCUS_OPTIONS,
  KEEPER_DISTRIBUTION_OPTIONS,
  CORNER_DELIVERY_OPTIONS,
  applyStyle,
  applyTacticsChange,
  cardMultiplier,
  chanceQualityMultiplier,
  defensiveDiscipline,
  shapeAttackMultiplier,
  isFormationName,
  isTacticalStyle,
  matchingStyle,
  normaliseTactics,
  offsideTrapChance,
  type TacticalStyle,
  type TacticalStyleName,
} from "./tactics";

export {
  PITCH_ANCHORS,
  SLOT_HOME,
  anchorAt,
  describeShape,
  isValidPlacement,
  placementsFromFormation,
  snapToAnchor,
  type PitchAnchor,
} from "./pitch";

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

export {
  analyseMatch,
  type AnalysisArea,
  type AnalysisAreaKey,
  type AnalysisVerdict,
  type IndividualRecommendation,
  type MatchAnalysis,
  type PlayerReport,
  type TrainingRecommendation,
} from "./analysis";

export {
  FOCUS_ATTRIBUTES,
  TRAINING,
  TRAINING_FOCUS_LABELS,
  accumulateDeltas,
  applyDeltas,
  isTrainingFocus,
  trainPlayer,
  trainSquad,
  type TrainableAttribute,
  type TrainingFocus,
  type TrainingIntensity,
  type TrainingPlan,
  type TrainingResult,
} from "./training";

export {
  TRANSFER,
  askingAfterAppetite,
  askingPrice,
  clubTransferAppetite,
  evaluateBid,
  playerWageDemand,
  squadNeed,
  transferValue,
  wageAcceptance,
  type BidVerdict,
  type SquadNeed,
  type TransferTarget,
} from "./transferMarket";

export { MATCH, FATIGUE, DISCIPLINE, COLOUR } from "./constants";
