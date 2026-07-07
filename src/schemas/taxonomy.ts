import { z } from "zod";

/**
 * One entry of a cached external taxonomy (D9: skill-gap inputs are
 * decomposed against authoritative external taxonomies — SkillsFuture TSCs
 * first — never invented ad hoc).
 */
export const TaxonomyEntry = z.object({
  taxonomy_id: z.string(), // e.g. "skillsfuture"
  ref: z.string().min(1), // e.g. TSC code
  title: z.string().min(1),
  description: z.string().default(""),
  sector: z.string().optional(),
  proficiency_levels: z.array(z.string()).default([]),
});
export type TaxonomyEntry = z.infer<typeof TaxonomyEntry>;

export const TaxonomyCacheFile = z.object({
  taxonomy_id: z.string(),
  source_url: z.string(),
  cached_at: z.string().datetime(),
  entries: z.array(TaxonomyEntry).min(1),
});
export type TaxonomyCacheFile = z.infer<typeof TaxonomyCacheFile>;

/** LLM-proposed mapping of extracted skills onto cached taxonomy entries. */
export const TaxonomyMapping = z.array(
  z.object({
    skill_name: z.string(),
    /** Must exist in the cache — enforced in code, null = honestly unmappable. */
    taxonomy_ref: z.string().nullable(),
    confidence: z.number().min(0).max(1),
  })
);
export type TaxonomyMapping = z.infer<typeof TaxonomyMapping>;
