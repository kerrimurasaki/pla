import { z } from "zod";

/** A learner-supplied goal: job ad, position description, task, or aspiration. */
export const LearnerGoal = z.object({
  goal_id: z.string(),
  learner_id: z.string(),
  kind: z.enum(["job_ad", "position_description", "task", "aspiration"]),
  raw_text: z.string().min(1),
  /** Provenance (Invariant 4): where this text came from. */
  source: z.object({
    type: z.enum(["url", "pasted_text", "file"]),
    url: z.string().url().optional(),
    retrieved_at: z.string().datetime(),
  }),
});
export type LearnerGoal = z.infer<typeof LearnerGoal>;

/**
 * A skill extracted from a goal. `evidence_quote` must be a verbatim span of
 * the goal text — extraction is grounded in what the goal actually says, not
 * what a model imagines the role needs.
 */
export const ExtractedSkill = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  evidence_quote: z.string().min(1),
});
export type ExtractedSkill = z.infer<typeof ExtractedSkill>;

export const GoalAnalysis = z.object({
  goal_id: z.string(),
  extracted_skills: z.array(ExtractedSkill).min(1),
  analyzed_at: z.string().datetime(),
});
export type GoalAnalysis = z.infer<typeof GoalAnalysis>;

export const LearnerProfile = z.object({
  learner_id: z.string(),
  goal_id: z.string(),
  target_role: z.string().optional(),
  /** skill name → taxonomy ref (or null when honestly unmappable). */
  taxonomy_mapping: z.record(z.string(), z.string().nullable()),
  preferences: z.record(z.string(), z.unknown()).default({}),
});
export type LearnerProfile = z.infer<typeof LearnerProfile>;

/** Gap-marked node status in the personal graph. All start unverified (D5). */
export const NodeGapStatus = z.object({
  skill_id: z.string(),
  status: z.enum(["unverified", "in_progress", "verified"]),
});

export const PersonalSkillGraph = z.object({
  goal_id: z.string(),
  learner_id: z.string(),
  generated_at: z.string().datetime(),
  nodes: z.array(z.unknown()), // SkillDefinition[] — validated by SkillGraph on load
  gap_status: z.array(NodeGapStatus),
});
export type PersonalSkillGraph = z.infer<typeof PersonalSkillGraph>;
