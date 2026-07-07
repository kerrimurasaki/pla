import { z } from "zod";

/**
 * Example sequences (well-structured types only — never applied to
 * ill_structured_composite; that routing is enforced in validators).
 */
export const ExampleKind = z.enum(["positive", "negative", "test"]);

export const InstructionalExample = z.object({
  example_id: z.string(),
  kind: ExampleKind,
  /** The stimulus shown to the learner. */
  stimulus: z.string(),
  /** Expected learner response ("Yes"/"No"/label/production). */
  expected_response: z.string(),
  /** For negatives: which positive it is minimally different from, if any. */
  minimum_difference_of: z.string().optional(),
});
export type InstructionalExample = z.infer<typeof InstructionalExample>;

/**
 * A juxtaposition block: an atomic run of examples whose teaching power is
 * in adjacency (D2). Aborts restart from the top of the block.
 */
export const JuxtapositionBlock = z.object({
  block_id: z.string(),
  example_ids: z.array(z.string()).min(1),
});

export const ExampleSequence = z.object({
  skill_id: z.string(),
  sequence_type: z.enum(["negative_first", "positive_first", "comparative"]),
  /**
   * Identical phrasing across all examples in a sequence is a DI
   * requirement. All examples must use this template verbatim.
   */
  wording_template: z.string().min(1),
  examples: z.array(InstructionalExample).min(3),
  /** Juxtaposition blocks MUST be marked so delivery knows legal restart points. */
  juxtaposition_blocks: z.array(JuxtapositionBlock).min(1),
});
export type ExampleSequence = z.infer<typeof ExampleSequence>;

/** One overt step of a cognitive routine. Observable, testable, functional. */
export const RoutineStep = z.object({
  step_number: z.number().int().positive(),
  teacher_says: z.string().min(1),
  learner_does: z.string().min(1),
  correct_feedback: z.string().min(1),
  error_feedback: z.string().min(1),
});
export type RoutineStep = z.infer<typeof RoutineStep>;

/**
 * A covertization stage. Delivery is verbatim replay of `steps`;
 * no runtime paraphrase (D2 Focus-DI rule).
 */
export const RoutineStage = z.object({
  skill_id: z.string(),
  stage_id: z.string(), // "ORIGINAL" | "A" | "B" | "C" | "INDEPENDENT" or similar
  percent_overt: z.number().min(0).max(100),
  steps: z.array(RoutineStep),
  /** Sha-256 of the frozen content; delivery layer verifies before replay. */
  content_hash: z.string().optional(),
});
export type RoutineStage = z.infer<typeof RoutineStage>;

export const Routine = z.object({
  skill_id: z.string(),
  /** Ordered from fully overt to independent. percent_overt must be non-increasing. */
  stages: z.array(RoutineStage).min(2),
});
export type Routine = z.infer<typeof Routine>;
