import { z } from "zod";

/**
 * Shortcut check (Invariant 1): every field must be false or the item is
 * rejected by the validator.
 */
export const ShortcutCheck = z.object({
  pattern_matching_possible: z.boolean(),
  process_of_elimination_possible: z.boolean(),
  memorization_possible: z.boolean(),
});

export const CommonError = z.object({
  error: z.string(),
  diagnosis: z.string(),
  /** Must be specific: what went wrong, why, what to do (never "try again"). */
  feedback: z.string().min(20),
});

/** Standard production item for well-structured skills. */
export const PracticeItem = z.object({
  item_id: z.string(),
  skill_id: z.string(),
  stimulus: z.string().min(1),
  /** Production, not selection — there is no options list on purpose. */
  correct_response: z.string().min(1),
  skill_requirement: z.string().min(1),
  /** True iff this example was never shown during instruction. */
  novel: z.boolean(),
  difficulty_stage: z.string().optional(),
  shortcut_check: ShortcutCheck,
  common_errors: z.array(CommonError).min(1),
});
export type PracticeItem = z.infer<typeof PracticeItem>;
