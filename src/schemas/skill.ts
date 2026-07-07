import { z } from "zod";
import { ConceptType } from "./concept.js";

/** Mastery criteria per skill (D5/D8 — advisory on progression, hard on claims). */
export const MasteryCriteria = z.object({
  /** Well-structured: production accuracy threshold. Default 0.85 (validated, keep). */
  threshold: z.number().min(0).max(1).default(0.85),
  /** Consecutive correct on varied novel examples. Default 5 (3–5 range). */
  required_consecutive: z.number().int().min(3).max(5).default(5),
  /** Ill-structured only: criss-crossing gate (TUNABLE — D8, has kill criteria). */
  criss_crossing: z
    .object({
      min_disciplinary_dimensions: z.number().int().min(1).default(3),
      min_same_case_revisits_different_lens: z.number().int().min(0).default(1),
      oral_defense_required: z.boolean().default(true),
    })
    .optional(),
});
export type MasteryCriteria = z.infer<typeof MasteryCriteria>;

export const SkillDefinition = z.object({
  skill_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  concept_type: ConceptType,
  /** Skill IDs this node depends on (edges of the DAG). */
  prerequisites: z.array(z.string()).default([]),
  /**
   * Required for ill_structured_composite: the well-structured component
   * skill IDs (decomposition duty, D4). Must be empty for classic types.
   */
  component_skill_ids: z.array(z.string()).default([]),
  mastery_criteria: MasteryCriteria,
  /** External industry taxonomy refs (e.g. SkillsFuture TSC ids). */
  taxonomy_refs: z
    .array(z.object({ taxonomy_id: z.string(), ref: z.string(), proficiency_level: z.string().optional() }))
    .default([]),
});
export type SkillDefinition = z.infer<typeof SkillDefinition>;
