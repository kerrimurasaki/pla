import { z } from "zod";

/**
 * The six concept types (D4). Five Engelmann-Carnine types for
 * well-structured skills plus the ill_structured_composite routing type.
 */
export const ConceptType = z.enum([
  "single_dimension_non_comparative",
  "noun",
  "comparative",
  "cognitive_routine",
  "correlated_features",
  "ill_structured_composite",
]);
export type ConceptType = z.infer<typeof ConceptType>;

export const WELL_STRUCTURED_TYPES: ConceptType[] = [
  "single_dimension_non_comparative",
  "noun",
  "comparative",
  "cognitive_routine",
  "correlated_features",
];

export function isWellStructured(t: ConceptType): boolean {
  return t !== "ill_structured_composite";
}

/**
 * The four-question routing test for ill_structured_composite (D4).
 * Route to the case engine when the answers are mostly YES.
 */
export const FourQuestionTest = z.object({
  experts_disagree_on_best_converge_on_indefensible: z.boolean(),
  relevant_features_shift_between_instances: z.boolean(),
  fixed_procedure_would_sometimes_fail: z.boolean(),
  requires_recombining_component_skills_per_situation: z.boolean(),
});
export type FourQuestionTest = z.infer<typeof FourQuestionTest>;

export function fourQuestionYesCount(t: FourQuestionTest): number {
  return [
    t.experts_disagree_on_best_converge_on_indefensible,
    t.relevant_features_shift_between_instances,
    t.fixed_procedure_would_sometimes_fail,
    t.requires_recombining_component_skills_per_situation,
  ].filter(Boolean).length;
}

/** "Mostly YES" — 3 or 4 of the four questions. */
export function routesToCaseEngine(t: FourQuestionTest): boolean {
  return fourQuestionYesCount(t) >= 3;
}

/** A component of a composite: MUST be one of the five classic types (D4). */
export const ClassicComponentSkill = z.object({
  name: z.string(),
  concept_type: ConceptType.refine((t) => t !== "ill_structured_composite", {
    message: "Components of an ill_structured_composite must be one of the five classic types",
  }),
});
export type ClassicComponentSkill = z.infer<typeof ClassicComponentSkill>;

export const ConceptClassification = z.object({
  concept: z.string(),
  concept_type: ConceptType,
  four_question_test: FourQuestionTest,
  rationale: z.string(),
  /** Required when concept_type is ill_structured_composite (decomposition duty). */
  component_skills: z.array(ClassicComponentSkill).optional(),
});
export type ConceptClassification = z.infer<typeof ConceptClassification>;
