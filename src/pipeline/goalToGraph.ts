import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LearnerGoal, GoalAnalysis, LearnerProfile, PersonalSkillGraph } from "../schemas/goal.js";
import { TaxonomyCacheFile, TaxonomyMapping } from "../schemas/taxonomy.js";
import { PracticeItem } from "../schemas/item.js";
import { extractSkills } from "./skillExtraction.js";
import { buildSkillGraph } from "./graphBuilder.js";
import { generateDiagnostic, DiagnosticGenerationError } from "./diagnostics.js";
import { mapToTaxonomy } from "../core/taxonomy.js";
import { LLMProvider } from "../llm/provider.js";
import { isWellStructured } from "../schemas/concept.js";

export interface GoalToGraphResult {
  analysis: GoalAnalysis;
  skill_graph: PersonalSkillGraph;
  profile: LearnerProfile;
  taxonomy_mapping: TaxonomyMapping;
  diagnostics: PracticeItem[];
  /** Skills whose diagnostic generation failed after retries (non-fatal). */
  diagnostic_failures: Array<{ skill_id: string; reason: string }>;
}

/**
 * Phase 2 orchestrator: learner drops in a goal → typed, gap-marked personal
 * skill graph plus ready-to-run diagnostic items, persisted per the file
 * architecture. Every node starts "unverified" — gaps close only through
 * production evidence (Invariant 3), never through the graph build itself.
 */
export async function goalToGraph(
  goal: LearnerGoal,
  taxonomyCache: TaxonomyCacheFile,
  provider: LLMProvider,
  rootDir: string
): Promise<GoalToGraphResult> {
  const analysis = await extractSkills(goal, provider);
  const { graph, classifications } = await buildSkillGraph(analysis.extracted_skills, provider);
  const taxonomy_mapping = await mapToTaxonomy(analysis.extracted_skills, taxonomyCache, provider);

  // Diagnostics for well-structured nodes only; composites are case-assessed.
  const diagnostics: PracticeItem[] = [];
  const diagnostic_failures: GoalToGraphResult["diagnostic_failures"] = [];
  for (const node of graph.all()) {
    if (!isWellStructured(node.concept_type)) continue;
    try {
      diagnostics.push(await generateDiagnostic(node, provider));
    } catch (err) {
      if (err instanceof DiagnosticGenerationError) {
        diagnostic_failures.push({ skill_id: node.skill_id, reason: err.message });
      } else {
        throw err;
      }
    }
  }

  const skill_graph: PersonalSkillGraph = {
    goal_id: goal.goal_id,
    learner_id: goal.learner_id,
    generated_at: new Date().toISOString(),
    nodes: graph.all(),
    gap_status: graph.all().map((n) => ({ skill_id: n.skill_id, status: "unverified" as const })),
  };

  const profile: LearnerProfile = {
    learner_id: goal.learner_id,
    goal_id: goal.goal_id,
    taxonomy_mapping: Object.fromEntries(taxonomy_mapping.map((m) => [m.skill_name, m.taxonomy_ref])),
    preferences: {},
  };

  // Persist per the file architecture.
  const currDir = join(rootDir, "Curriculum", goal.goal_id);
  await mkdir(currDir, { recursive: true });
  await writeFile(join(currDir, "original.txt"), goal.raw_text, "utf8");
  await writeFile(
    join(currDir, "analysis.json"),
    JSON.stringify({ goal, analysis, classifications, taxonomy_mapping }, null, 2),
    "utf8"
  );
  await writeFile(join(currDir, "skill_graph.json"), JSON.stringify(skill_graph, null, 2), "utf8");

  const learnerDir = join(rootDir, "Learners", goal.learner_id);
  await mkdir(learnerDir, { recursive: true });
  await writeFile(join(learnerDir, "profile.json"), JSON.stringify(profile, null, 2), "utf8");

  for (const skill of graph.all()) {
    const skillDir = join(rootDir, "Skills", skill.skill_id);
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "definition.json"), JSON.stringify(skill, null, 2), "utf8");
  }
  const diagDir = join(currDir, "diagnostics");
  await mkdir(diagDir, { recursive: true });
  for (const item of diagnostics) {
    await writeFile(join(diagDir, `${item.item_id}.json`), JSON.stringify(item, null, 2), "utf8");
  }

  return { analysis, skill_graph, profile, taxonomy_mapping, diagnostics, diagnostic_failures };
}
