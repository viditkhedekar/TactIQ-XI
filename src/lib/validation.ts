/**
 * Input validation.
 *
 * Everything that arrives from a browser passes through here first. The engine
 * clamps tactical values defensively too, but that is a safety net, not the
 * boundary: a malformed lineup should be rejected with a clear message rather
 * than quietly corrected into something the manager did not ask for.
 */

import { z } from "zod";
import {
  CORNER_DELIVERY_OPTIONS,
  FINAL_THIRD_OPTIONS,
  FORMATION_NAMES,
  KEEPER_DISTRIBUTION_OPTIONS,
  PASSING_FOCUS_OPTIONS,
  isTrainingFocus,
  isValidPlacement,
} from "@/engine";
import { PL_CLUB_IDS } from "@/data/clubs";

/** Doubles as the login, so it has to be readable and unambiguous. */
export const usernameSchema = z
  .string()
  .trim()
  .min(3, "Pick a name of at least 3 characters")
  .max(20, "Keep it to 20 characters or fewer")
  .regex(
    /^[A-Za-z0-9_-]+$/,
    "Letters, numbers, hyphens and underscores only",
  );

export const clubIdSchema = z
  .number()
  .int()
  .refine((id) => PL_CLUB_IDS.includes(id), "That is not a Premier League club");

export const createCareerSchema = z.object({
  username: usernameSchema,
  clubId: clubIdSchema.optional(),
});

const instructionSchema = z.number().int().min(1).max(5);

export const SLOT_VALUES = [
  "GK", "LB", "LCB", "CB", "RCB", "RB", "LWB", "RWB", "CDM", "LCM", "CM",
  "RCM", "CAM", "LM", "RM", "LW", "RW", "ST", "LST", "RST",
] as const;

export const slotSchema = z.enum(SLOT_VALUES);

/**
 * A player and where he is standing.
 *
 * The coordinates are checked against the anchor list rather than merely being
 * numbers in range, because a placement that is not on an anchor has no
 * recognised role behind it, and the whole simulation reads the role.
 */
export const lineupEntrySchema = z
  .object({
    playerId: z.number().int().positive(),
    slot: slotSchema,
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
  })
  .refine(isValidPlacement, "That is not a position on the pitch");

const setPiecesSchema = z.object({
  corners: z.number().int().positive().nullable(),
  freeKicks: z.number().int().positive().nullable(),
  penalties: z.number().int().positive().nullable(),
  throwIns: z.number().int().positive().nullable(),
  cornerDelivery: z.enum(CORNER_DELIVERY_OPTIONS),
});

export const tacticsSchema = z
  .object({
    // Still accepted and stored, but no longer chosen: the shape comes from
    // where the eleven are standing. Kept so the AI's own templates and any
    // team sheet written before the board became draggable still round-trip.
    formation: z.enum(FORMATION_NAMES as [string, ...string[]]),
    mentality: instructionSchema,
    pressing: instructionSchema,
    tempo: instructionSchema,
    width: instructionSchema,
    directness: instructionSchema,
    defensiveLine: instructionSchema,
    closingDown: instructionSchema,
    tackling: instructionSchema,
    offsideTrap: z.boolean(),
    finalThird: z.enum(FINAL_THIRD_OPTIONS),
    passingFocus: z.enum(PASSING_FOCUS_OPTIONS),
    keeperDistribution: z.enum(KEEPER_DISTRIBUTION_OPTIONS),
    setPieces: setPiecesSchema,
    captainId: z.number().int().positive().nullable(),
    lineup: z.array(lineupEntrySchema).length(11, "Name exactly eleven players"),
    bench: z.array(z.number().int().positive()).max(9, "The bench holds nine at most"),
  })
  .refine(
    (t) => {
      // Two players cannot occupy the same spot on the board.
      const spots = t.lineup.map((e) => `${e.x}:${e.y}`);
      return new Set(spots).size === spots.length;
    },
    { message: "Two players are standing in the same place", path: ["lineup"] },
  )
  .refine(
    (t) => new Set(t.lineup.map((e) => e.playerId)).size === 11,
    { message: "A player cannot fill two positions", path: ["lineup"] },
  )
  .refine(
    (t) => t.lineup.filter((e) => e.slot === "GK").length === 1,
    { message: "Name exactly one goalkeeper", path: ["lineup"] },
  )
  .refine(
    (t) => {
      const starters = new Set(t.lineup.map((e) => e.playerId));
      return t.bench.every((id) => !starters.has(id));
    },
    { message: "A starter cannot also be on the bench", path: ["bench"] },
  )
  .refine(
    (t) => new Set(t.bench).size === t.bench.length,
    { message: "The same substitute is listed twice", path: ["bench"] },
  );

export const substitutionSchema = z.object({
  off: z.number().int().positive(),
  on: z.number().int().positive(),
});

export const interventionSchema = z.object({
  /** The minute the manager was watching when they paused. */
  atMinute: z.number().int().min(0).max(120),
  /**
   * Everything is optional, and everything a manager can set before kick off
   * can also be changed during the match. Half time is exactly when a manager
   * wants to drop the line, stop stepping up, or put someone else on penalties,
   * so restricting this to the original five sliders would have made the
   * pre-match screen the only place most of the plan existed.
   */
  tactics: z
    .object({
      formation: z.enum(FORMATION_NAMES as [string, ...string[]]).optional(),
      mentality: instructionSchema.optional(),
      pressing: instructionSchema.optional(),
      tempo: instructionSchema.optional(),
      width: instructionSchema.optional(),
      directness: instructionSchema.optional(),
      defensiveLine: instructionSchema.optional(),
      closingDown: instructionSchema.optional(),
      tackling: instructionSchema.optional(),
      offsideTrap: z.boolean().optional(),
      finalThird: z.enum(FINAL_THIRD_OPTIONS).optional(),
      passingFocus: z.enum(PASSING_FOCUS_OPTIONS).optional(),
      keeperDistribution: z.enum(KEEPER_DISTRIBUTION_OPTIONS).optional(),
      setPieces: setPiecesSchema.optional(),
      captainId: z.number().int().positive().nullable().optional(),
    })
    .optional(),
  /**
   * Moving players around the pitch mid-match. Partial, because a manager
   * shuffling to a back three at half time changes some placements and not
   * others, and the ones he did not touch should stay where they are.
   */
  placements: z.array(lineupEntrySchema).max(11).optional(),
  subs: z.array(substitutionSchema).max(5).optional(),
});

export const trainingPlanSchema = z.object({
  focus: z
    .string()
    .refine(isTrainingFocus, "That is not a training focus"),
  intensity: z
    .number()
    .int()
    .min(1, "Intensity runs from 1 to 5")
    .max(5, "Intensity runs from 1 to 5"),
});

/**
 * A bid. The upper bounds are not realism, they are a guard: a fee of 1e30
 * would otherwise sail through the budget check as a float and corrupt the
 * finance row.
 */
export const offerSchema = z.object({
  playerId: z.number().int().positive(),
  feeEur: z
    .number()
    .int("Enter the fee in whole euros")
    .min(100_000, "The smallest bid anyone will consider is 100,000")
    .max(1_000_000_000, "That is not a serious offer"),
  wageEur: z
    .number()
    .int("Enter the wage in whole euros")
    .min(1_000, "Nobody signs for that")
    .max(5_000_000, "That is not a serious wage"),
});

export type CreateCareerInput = z.infer<typeof createCareerSchema>;
export type TrainingPlanInput = z.infer<typeof trainingPlanSchema>;
export type OfferInput = z.infer<typeof offerSchema>;
export type TacticsInput = z.infer<typeof tacticsSchema>;
export type InterventionInput = z.infer<typeof interventionSchema>;

/** First error message from a failed parse, for showing in the interface. */
export function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "That does not look right";
}
