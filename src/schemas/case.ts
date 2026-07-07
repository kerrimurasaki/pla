import { z } from "zod";

/**
 * Case provenance (Invariant 4 / D1): every case carries a real source with
 * citation and verified facts. No fabricated case facts, ever.
 */
export const CaseSource = z.object({
  case_id: z.string(),
  title: z.string().min(1),
  source_url: z.string().url().or(z.string().startsWith("doi:")),
  citation: z.string().min(10),
  retrieved_at: z.string().datetime(),
  /** Facts extracted from the source; each must be traceable to it. */
  verified_facts: z
    .array(z.object({ fact: z.string().min(1), location_in_source: z.string().min(1) }))
    .min(1),
});
export type CaseSource = z.infer<typeof CaseSource>;

/**
 * Two-layer thematic vector on each SEGMENT (D3): disciplinary weights
 * mapped where possible to the external taxonomy, plus concept weights
 * referencing actual skill-graph node IDs.
 */
export const SegmentVector = z.object({
  /** e.g. { finance: 0.9, legal_ethics: 0.4 } — keys from vector_schema.json */
  disciplinary: z.record(z.string(), z.number().min(0).max(1)),
  /** e.g. { sunk_cost: 0.9, npv: 0.3 } — keys are skill-graph node IDs */
  concepts: z.record(z.string(), z.number().min(0).max(1)),
});

export const CaseSegment = z.object({
  segment_id: z.string(),
  case_id: z.string(),
  /** Text span from the grounded source — never generated. */
  text: z.string().min(1),
  vector: SegmentVector,
  /** Expert commentary: HOW each high-weight dimension instantiates here. */
  commentary: z.record(z.string(), z.string()),
});
export type CaseSegment = z.infer<typeof CaseSegment>;

export const VectorSchema = z.object({
  domain: z.string(),
  /** Active disciplinary dimensions, mapped to taxonomy categories where possible. */
  disciplinary_dimensions: z
    .array(z.object({ key: z.string(), label: z.string(), taxonomy_ref: z.string().optional() }))
    .min(2),
});

/**
 * Rubric indicator for case-response items. Must be observable AND anchored
 * to specific case facts/segments (blocks eloquent genericism — Invariant 1
 * modified form).
 */
export const RubricIndicator = z.object({
  indicator: z.string().min(10),
  anchored_to: z.union([z.string(), z.array(z.string()).min(1)]),
});

export const CaseTask = z.object({
  task_id: z.string(),
  case_id: z.string(),
  segment_ids: z.array(z.string()).min(1),
  target_concepts: z.array(z.string()).min(1),
  prompt: z.string().min(1),
  rubric: z.array(RubricIndicator).min(2),
  defense_required: z.boolean(),
  shortcut_check: z.object({
    generic_fluency_sufficient: z.boolean(),
    note: z.string(),
  }),
});
export type CaseTask = z.infer<typeof CaseTask>;
