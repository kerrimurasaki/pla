import { z } from "zod";
import { EvidenceTier } from "./events.js";

export const ClaimEvidence = z.object({
  event_hash: z.string(),
  tier: EvidenceTier,
  type: z.string(),
  date: z.string(),
  rubric_coverage: z.number().min(0).max(1).optional(),
});

/**
 * Competency claim (D7). Speaks employer language via an external taxonomy.
 * No institutional/accreditation fields — removed by decision.
 */
export const CompetencyClaim = z.object({
  claim_id: z.string(),
  learner_id: z.string(),
  taxonomy_ref: z.string().min(1),
  constituent_skills: z.array(z.string()).min(1),
  evidence: z.array(ClaimEvidence).min(1),
  verified_as_of: z.string(),
  chain_root: z.string(),
});
export type CompetencyClaim = z.infer<typeof CompetencyClaim>;

/** Derived mastery view — always recomputable from the event log (log wins). */
export const MasteryView = z.object({
  learner_id: z.string(),
  skill_id: z.string(),
  mastery_state: z.object({
    current_level: z.number().min(0).max(1),
    threshold: z.number(),
    consecutive_correct: z.number().int(),
    required_consecutive: z.number().int(),
    credential_eligible: z.boolean(),
  }),
  /** Ill-structured coverage analytics (only present for composite skills). */
  dimensional_coverage: z
    .object({
      dimensions_produced: z.array(z.string()),
      same_case_revisit_different_lens: z.boolean(),
      oral_defense_passed: z.boolean(),
    })
    .optional(),
  event_count: z.number().int(),
  last_event_hash: z.string(),
});
export type MasteryView = z.infer<typeof MasteryView>;
