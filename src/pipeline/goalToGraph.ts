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
export interface GoalToGraphOptions {
  /**
   * Skip diagnostic-item generation (the most expensive round: generate +
   * adversarial judge, with possible regenerations). Escape hatch for tight
   * serverless budgets — the graph is still fully typed and gap-marked.
   */
  include_diagnostics?: boolean;
}

export async function goalToGraph(
  goal: LearnerGoal,
  taxonomyCache: TaxonomyCacheFile,
  provider: LLMProvider,
  rootDir: string,
  opts: GoalToGraphOptions = {}
): Promise<GoalToGraphResult> {
  const includeDiagnostics = opts.include_diagnostics !== false;
  const analysis = await extractSkills(goal, provider);

  // Graph building and taxonomy mapping both depend only on the extraction —
  // run them concurrently (one LLM round saved on the serverless budget).
  const [{ graph, classifications }, taxonomy_mapping] = await Promise.all([
    buildSkillGraph(analysis.extracted_skills, provider),
    mapToTaxonomy(analysis.extracted_skills, taxonomyCache, provider),
  ]);

  // Diagnostics for well-structured nodes only; composites are case-assessed.
  // Items are independent — generate concurrently (wall-clock budget on
  // serverless), collecting per-node failures without failing the batch.
  const wellStructured = includeDiagnostics
    ? graph.all().filter((n) => isWellStructured(n.concept_type))
    : [];
  const outcomes = await Promise.all(
    wellStructured.map(async (node) => {
      try {
        return { node, item: await generateDiagnostic(node, provider) };
      } catch (err) {
        if (err instanceof DiagnosticGenerationError) {
          return { node, failure: err.message };
        }
        throw err;
      }
    })
  );
  const diagnostics: PracticeItem[] = outcomes
    .filter((o): o is { node: (typeof wellStructured)[number]; item: PracticeItem } => "item" in o)
    .map((o) => o.item);
  const diagnostic_failures: GoalToGraphResult["diagnostic_failures"] = outcomes
    .filter((o): o is { node: (typeof wellStructured)[number]; failure: string } => "failure" in o)
    .map((o) => ({ skill_id: o.node.skill_id, reason: o.failure }));

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
