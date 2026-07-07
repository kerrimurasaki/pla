import { z } from "zod";
import { ConceptClassification } from "../schemas/concept.js";
import { SkillDefinition } from "../schemas/skill.js";
import { ExtractedSkill } from "../schemas/goal.js";
import { SkillGraph } from "../core/skillGraph.js";
import { classifyConcept } from "../core/classifier.js";
import { LLMProvider } from "../llm/provider.js";
import { extractJson } from "../util/json.js";

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const PREREQ_SYSTEM = `You propose prerequisite edges among a fixed set of skills.

Rules:
- Only use skill ids from the provided list. Never invent ids.
- An edge means: the prerequisite must typically be acquired BEFORE the skill (component knowledge the skill builds on).
- Propose only edges you are confident about. A sparse honest graph beats a dense guessed one.
- The result must be acyclic.

Respond with ONLY JSON:
{ "prerequisites": { "<skill_id>": ["<prerequisite_skill_id>", ...] } }`;

const PrereqResponse = z.object({
  prerequisites: z.record(z.string(), z.array(z.string())),
});

export interface BuiltGraph {
  graph: SkillGraph;
  classifications: ConceptClassification[];
}

/**
 * Build a typed personal skill graph from extracted skills:
 * classify each (six types, four-question test enforced), materialize
 * composite decompositions as real component nodes, propose prerequisite
 * edges among known ids only, and DAG-validate the result.
 */
export async function buildSkillGraph(
  skills: ExtractedSkill[],
  provider: LLMProvider
): Promise<BuiltGraph> {
  const graph = new SkillGraph();

  // Classifications are independent of each other — run them concurrently
  // (serverless wall-clock budgets make sequential per-skill calls a
  // timeout, observed on the first real Vercel run). Assembly below stays
  // sequential and deterministic in the original skill order.
  const classifications: ConceptClassification[] = await Promise.all(
    skills.map((s) => classifyConcept(`${s.name} — ${s.description}`, provider))
  );

  for (let i = 0; i < skills.length; i++) {
    const s = skills[i];
    const c = classifications[i];
    const skillId = slugify(s.name);

    // Decomposition duty (D4): components become first-class classic-type nodes.
    const componentIds: string[] = [];
    for (const comp of c.component_skills ?? []) {
      const compId = slugify(comp.name);
      componentIds.push(compId);
      if (!graph.get(compId)) {
        graph.add(
          SkillDefinition.parse({
            skill_id: compId,
            name: comp.name,
            description: `Component of ${s.name}`,
            concept_type: comp.concept_type,
            mastery_criteria: { threshold: 0.85, required_consecutive: 5 },
          })
        );
      }
    }

    graph.add(
      SkillDefinition.parse({
        skill_id: skillId,
        name: s.name,
        description: s.description,
        concept_type: c.concept_type,
        component_skill_ids: componentIds,
        mastery_criteria:
          c.concept_type === "ill_structured_composite"
            ? {
                threshold: 0.85,
                required_consecutive: 5,
                criss_crossing: {
                  min_disciplinary_dimensions: 3,
                  min_same_case_revisits_different_lens: 1,
                  oral_defense_required: true,
                },
              }
            : { threshold: 0.85, required_consecutive: 5 },
      })
    );
  }

  // Prerequisite edges among the ids that now exist (targets + components).
  const ids = graph.all().map((n) => n.skill_id);
  const raw = await provider.complete({
    system: PREREQ_SYSTEM,
    prompt:
      `Skill ids:\n` +
      graph
        .all()
        .map((n) => `- ${n.skill_id} (${n.concept_type}): ${n.description}`)
        .join("\n"),
    json: true,
    temperature: 0,
  });
  const prereqs = PrereqResponse.parse(JSON.parse(extractJson(raw))).prerequisites;

  const known = new Set(ids);
  for (const [skillId, list] of Object.entries(prereqs)) {
    const node = graph.get(skillId);
    if (!node) continue; // unknown target id — drop silently rather than invent
    node.prerequisites = [...new Set(list.filter((p) => known.has(p) && p !== skillId))];
    graph.add(node);
  }

  const v = graph.validate();
  if (!v.valid) {
    throw new Error(`Generated skill graph failed validation:\n${v.errors.join("\n")}`);
  }
  return { graph, classifications };
}
