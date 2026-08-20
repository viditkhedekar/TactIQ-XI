/**
 * Running the training week.
 *
 * Training happens once per round, at the same moment as recovery, because it
 * is the same week: the days between two matches are either spent resting or
 * spent working, and the intensity slider is how the manager chooses. That is
 * why the fitness cost lives here and is subtracted from the recovery rather
 * than applied separately. A squad flogged all week turns up tired.
 *
 * Every club trains, not only the manager's. The AI clubs use a balanced plan
 * at ordinary intensity, which is enough to stop the manager's squad quietly
 * pulling away from a division that never develops. Only the manager's club
 * gets a written report, since nobody is going to read nineteen of them.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  careerPlayerState,
  careerTraining,
  players,
  trainingReports,
  type CareerTrainingRow,
} from "@/db/schema";
import {
  accumulateDeltas,
  applyDeltas,
  createRng,
  hash32,
  isTrainingFocus,
  trainPlayer,
  type TrainableAttribute,
  type TrainingFocus,
  type TrainingIntensity,
} from "@/engine";
import { toAttributeDeltas, toEnginePlayer } from "./engineAdapter";

export type TrainingPlanView = {
  focus: TrainingFocus;
  intensity: TrainingIntensity;
};

const DEFAULT_PLAN: TrainingPlanView = { focus: "balanced", intensity: 3 };

/** What the AI clubs do, since they have no manager to choose for them. */
const AI_PLAN: TrainingPlanView = { focus: "balanced", intensity: 3 };

function toPlan(row: CareerTrainingRow | undefined): TrainingPlanView {
  if (!row) return DEFAULT_PLAN;
  return {
    focus: isTrainingFocus(row.focus) ? row.focus : "balanced",
    intensity: Math.max(1, Math.min(5, row.intensity)) as TrainingIntensity,
  };
}

export async function loadTrainingPlan(careerId: string): Promise<TrainingPlanView> {
  const rows = await db
    .select()
    .from(careerTraining)
    .where(eq(careerTraining.careerId, careerId))
    .limit(1);
  return toPlan(rows[0]);
}

export async function saveTrainingPlan(
  careerId: string,
  focus: TrainingFocus,
  intensity: TrainingIntensity,
): Promise<void> {
  await db
    .insert(careerTraining)
    .values({ careerId, focus, intensity })
    .onConflictDoUpdate({
      target: careerTraining.careerId,
      set: { focus, intensity, updatedAt: new Date() },
    });
}

/**
 * Puts one player on his own programme, or takes him off it. Individual work
 * overrides the squad's focus for that player only.
 */
export async function setIndividualFocus(
  careerId: string,
  playerId: number,
  focus: TrainingFocus | null,
): Promise<void> {
  await db
    .update(careerPlayerState)
    .set({ trainingFocus: focus })
    .where(
      and(eq(careerPlayerState.careerId, careerId), eq(careerPlayerState.playerId, playerId)),
    );
}

/* ------------------------------------------------------------- the week itself */

export type TrainingImprovement = {
  playerId: number;
  name: string;
  attribute: TrainableAttribute;
  from: number;
  to: number;
};

export type TrainingInjury = {
  playerId: number;
  name: string;
  outRounds: number;
};

export type WeeklyTraining = {
  /** Per player, what to write back. Keyed by player id. */
  byPlayer: Map<
    number,
    {
      attributeDeltas: Partial<Record<TrainableAttribute, number>>;
      fitnessCost: number;
      injuryOutRounds: number | null;
    }
  >;
  improvements: TrainingImprovement[];
  injuries: TrainingInjury[];
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Works out a week of training for every player in the career.
 *
 * Returns the changes rather than writing them, so the caller can fold them
 * into the recovery pass it is already making over the same rows instead of
 * issuing a second update per player.
 *
 * The RNG is seeded from the career and the round, so a week of training is
 * reproducible and does not depend on when it was run.
 */
export async function computeWeeklyTraining(
  tx: Tx,
  careerId: string,
  userClubId: number,
  round: number,
  plan: TrainingPlanView,
): Promise<WeeklyTraining> {
  const rows = await tx
    .select({ player: players, state: careerPlayerState })
    .from(players)
    .innerJoin(
      careerPlayerState,
      and(
        eq(careerPlayerState.playerId, players.id),
        eq(careerPlayerState.careerId, careerId),
      ),
    );

  const rng = createRng(hash32(`${careerId}-training-${round}`));

  const byPlayer: WeeklyTraining["byPlayer"] = new Map();
  const improvements: TrainingImprovement[] = [];
  const injuries: TrainingInjury[] = [];

  for (const { player: row, state } of rows) {
    const club = state.clubId ?? row.clubId;
    const isUsers = club === userClubId;

    // A player already out injured does not train.
    if (state.injuredUntilRound !== null && state.injuredUntilRound >= round) continue;

    const existing = toAttributeDeltas(state.attributeDeltas) ?? {};
    const base = toEnginePlayer(row, { fitness: state.fitness, form: state.form });

    const individual =
      isUsers && state.trainingFocus && isTrainingFocus(state.trainingFocus)
        ? state.trainingFocus
        : null;

    const active = isUsers ? plan : AI_PLAN;
    const result = trainPlayer(
      rng,
      base,
      row.potential,
      individual ?? active.focus,
      active.intensity,
    );

    const updated = accumulateDeltas(existing, result.deltas, base);

    byPlayer.set(row.id, {
      attributeDeltas: updated,
      fitnessCost: result.fitnessCost,
      injuryOutRounds: result.injury?.outRounds ?? null,
    });

    if (!isUsers) continue;

    // Only report movement the manager could actually see. Attributes are shown
    // rounded, so a tenth of a point is real but not yet worth telling them
    // about; the delta keeps accumulating either way.
    const before = applyDeltas(base, existing);
    const after = applyDeltas(base, updated);
    for (const attribute of Object.keys(result.deltas) as TrainableAttribute[]) {
      if (before[attribute] === after[attribute]) continue;
      improvements.push({
        playerId: row.id,
        name: row.shortName,
        attribute,
        from: before[attribute],
        to: after[attribute],
      });
    }

    if (result.injury) {
      injuries.push({ playerId: row.id, name: row.shortName, outRounds: result.injury.outRounds });
    }
  }

  return { byPlayer, improvements, injuries };
}

/** Stores the manager's training report for the round. */
export async function saveTrainingReport(
  tx: Tx,
  careerId: string,
  round: number,
  plan: TrainingPlanView,
  week: WeeklyTraining,
): Promise<void> {
  await tx
    .insert(trainingReports)
    .values({
      careerId,
      round,
      focus: plan.focus,
      intensity: plan.intensity,
      improvements: week.improvements,
      injuries: week.injuries,
    })
    // Quick-simming a round that was already partly settled should not blow up
    // on the unique constraint.
    .onConflictDoNothing();
}

/** The most recent training report, for the training screen. */
export async function loadLatestTrainingReport(careerId: string) {
  const rows = await db
    .select()
    .from(trainingReports)
    .where(eq(trainingReports.careerId, careerId))
    .orderBy(trainingReports.round)
    .limit(50);
  return rows[rows.length - 1] ?? null;
}

/** Individual focuses currently set, keyed by player id. */
export async function loadIndividualFocuses(
  careerId: string,
  playerIds: number[],
): Promise<Map<number, TrainingFocus>> {
  if (playerIds.length === 0) return new Map();

  const rows = await db
    .select({
      playerId: careerPlayerState.playerId,
      focus: careerPlayerState.trainingFocus,
    })
    .from(careerPlayerState)
    .where(
      and(
        eq(careerPlayerState.careerId, careerId),
        inArray(careerPlayerState.playerId, playerIds),
      ),
    );

  const out = new Map<number, TrainingFocus>();
  for (const row of rows) {
    if (row.focus && isTrainingFocus(row.focus)) out.set(row.playerId, row.focus);
  }
  return out;
}
