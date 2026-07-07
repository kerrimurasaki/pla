import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { TaxonomyCacheFile, TaxonomyEntry, TaxonomyMapping } from "../schemas/taxonomy.js";
import { ExtractedSkill } from "../schemas/goal.js";
import { LLMProvider } from "../llm/provider.js";
import { extractJson } from "../util/json.js";

export class TaxonomyIntegrityError extends Error {}

/** Cached external taxonomy at LearningAgent/Taxonomies/{taxonomy_id}/entries.json */
export class TaxonomyCache {
  constructor(private rootDir: string) {}

  private path(taxonomyId: string): string {
    return join(this.rootDir, "Taxonomies", taxonomyId, "entries.json");
  }

  async load(taxonomyId: string): Promise<TaxonomyCacheFile> {
    const raw = await readFile(this.path(taxonomyId), "utf8");
    return TaxonomyCacheFile.parse(JSON.parse(raw));
  }

  async save(file: TaxonomyCacheFile): Promise<void> {
    const p = this.path(file.taxonomy_id);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, JSON.stringify(TaxonomyCacheFile.parse(file), null, 2), "utf8");
  }
}

const SYSTEM = `You map extracted skills onto entries of an external industry taxonomy.

Rules:
- You may ONLY use refs from the provided entry list. Never invent a ref.
- If no entry is a genuine match, map to null — an honest null beats a forced match.
- Confidence reflects semantic fit of skill to entry description.

Respond with ONLY JSON:
{ "mapping": [ { "skill_name": "...", "taxonomy_ref": "<ref from the list or null>", "confidence": 0.0 } ] }`;

const MappingResponse = z.object({ mapping: TaxonomyMapping });

/**
 * map_to_taxonomy (D9): align skills to a cached external taxonomy.
 * The LLM proposes; code enforces that every non-null ref exists in the
 * cache — taxonomy entries are never invented ad hoc.
 */
export async function mapToTaxonomy(
  skills: ExtractedSkill[],
  cache: TaxonomyCacheFile,
  provider: LLMProvider
): Promise<TaxonomyMapping> {
  const entryList = cache.entries
    .map((e: TaxonomyEntry) => `- ref: ${e.ref} | ${e.title}: ${e.description}`)
    .join("\n");
  const skillList = skills.map((s) => `- ${s.name}: ${s.description}`).join("\n");

  const raw = await provider.complete({
    system: SYSTEM,
    prompt: `Taxonomy "${cache.taxonomy_id}" entries:\n${entryList}\n\nSkills to map:\n${skillList}`,
    json: true,
    temperature: 0,
  });
  const parsed = MappingResponse.parse(JSON.parse(extractJson(raw)));

  const validRefs = new Set(cache.entries.map((e) => e.ref));
  const invented = parsed.mapping.filter((m) => m.taxonomy_ref !== null && !validRefs.has(m.taxonomy_ref));
  if (invented.length > 0) {
    throw new TaxonomyIntegrityError(
      `Mapping references taxonomy entries that do not exist in the cache: ` +
        invented.map((m) => `${m.skill_name} → ${m.taxonomy_ref}`).join(", ") +
        ". Taxonomy refs are never invented ad hoc (D9)."
    );
  }

  const mappedNames = new Set(parsed.mapping.map((m) => m.skill_name));
  for (const s of skills) {
    if (!mappedNames.has(s.name)) {
      parsed.mapping.push({ skill_name: s.name, taxonomy_ref: null, confidence: 0 });
    }
  }
  return parsed.mapping;
}
