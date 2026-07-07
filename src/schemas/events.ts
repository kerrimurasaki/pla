import { z } from "zod";

/**
 * Evidence tiers (D7):
 *  1 — synchronous defended production (oral checks, live persona sims)
 *  2 — asynchronous production with captured process trail / unaided checks
 *  3 — ambient/unsupervised signal (adaptation only; NEVER evidence)
 */
export const EvidenceTier = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type EvidenceTier = z.infer<typeof EvidenceTier>;

export const EventType = z.enum([
  "practice_item",
  "micro_diagnostic",
  "case_task",
  "oral_defense",
  "persona_simulation",
  "process_trailed_artifact",
  "unaided_check",
]);
export type EventType = z.infer<typeof EventType>;

/** Ambient telemetry kinds — these may NEVER become mastery events (Invariant 3). */
export const TELEMETRY_KINDS = ["dwell", "scroll", "hover", "page_read", "click"] as const;

/**
 * One mastery event, appended to the per-learner×skill hash chain.
 * `event_hash = sha256(item_ref, response_ref, assessment_ref, timestamp, prior_event_hash)`.
 */
export const MasteryEvent = z.object({
  event_id: z.string(),
  learner_id: z.string(),
  skill_id: z.string(),
  event_type: EventType,
  tier: EvidenceTier,
  item_ref: z.string(),
  response_ref: z.string(),
  assessment_ref: z.string(),
  correct: z.boolean().optional(), // well-structured items
  rubric_coverage: z.number().min(0).max(1).optional(), // case tasks / defenses
  passed: z.boolean().optional(), // defenses / simulations
  /** Support level the response was produced at (covertization stage). */
  support_stage: z.string().optional(),
  /** For case events: which disciplinary dimension this traversal used. */
  disciplinary_dimension: z.string().optional(),
  case_id: z.string().optional(),
  /** For integrative tasks: all skill nodes the task spanned. */
  spanned_skill_ids: z.array(z.string()).optional(),
  timestamp: z.string().datetime(),
  prior_event_hash: z.string(),
  event_hash: z.string(),
});
export type MasteryEvent = z.infer<typeof MasteryEvent>;

/** Input to append: everything except the chain fields, which the log computes. */
export const MasteryEventInput = MasteryEvent.omit({
  prior_event_hash: true,
  event_hash: true,
});
export type MasteryEventInput = z.infer<typeof MasteryEventInput>;

export const GENESIS_HASH = "0".repeat(64);
