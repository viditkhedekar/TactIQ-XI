/**
 * Input validation.
 *
 * Everything that arrives from a browser passes through here first. The engine
 * clamps tactical values defensively too, but that is a safety net, not the
 * boundary: a malformed lineup should be rejected with a clear message rather
 * than quietly corrected into something the manager did not ask for.
 */

import { z } from "zod";
import { FORMATION_NAMES } from "@/engine";
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

export const lineupEntrySchema = z.object({
  playerId: z.number().int().positive(),
  slot: slotSchema,
});

export const tacticsSchema = z
  .object({
    formation: z.enum(FORMATION_NAMES as [string, ...string[]]),
    mentality: instructionSchema,
    pressing: instructionSchema,
    tempo: instructionSchema,
    width: instructionSchema,
    directness: instructionSchema,
    lineup: z.array(lineupEntrySchema).length(11, "Name exactly eleven players"),
    bench: z.array(z.number().int().positive()).max(9, "The bench holds nine at most"),
  })
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
  tactics: z
    .object({
      formation: z.enum(FORMATION_NAMES as [string, ...string[]]).optional(),
      mentality: instructionSchema.optional(),
      pressing: instructionSchema.optional(),
      tempo: instructionSchema.optional(),
      width: instructionSchema.optional(),
      directness: instructionSchema.optional(),
    })
    .optional(),
  subs: z.array(substitutionSchema).max(5).optional(),
});

export type CreateCareerInput = z.infer<typeof createCareerSchema>;
export type TacticsInput = z.infer<typeof tacticsSchema>;
export type InterventionInput = z.infer<typeof interventionSchema>;

/** First error message from a failed parse, for showing in the interface. */
export function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "That does not look right";
}
