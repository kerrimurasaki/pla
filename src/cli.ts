/**
 * Minimal CLI for running the pipeline against a real provider.
 *
 *   npm run pla -- goal <path-or-url> [--learner alice] [--kind job_ad]
 *                  [--taxonomy skillsfuture_sample] [--root LearningAgent]
 *
 * Provider is picked from ANTHROPIC_API_KEY / GOOGLE_API_KEY / OPENAI_API_KEY.
 */
import { readFile } from "node:fs/promises";
import { AnthropicProvider, GeminiProvider, OpenAIProvider, LLMProvider } from "./llm/provider.js";
import { ingestGoalText, ingestGoalUrl } from "./pipeline/goalIngestion.js";
import { goalToGraph } from "./pipeline/goalToGraph.js";
import { TaxonomyCache } from "./core/taxonomy.js";
import { LearnerGoal } from "./schemas/goal.js";

function pickProvider(): LLMProvider {
  if (process.env.ANTHROPIC_API_KEY) return new AnthropicProvider();
  if (process.env.GOOGLE_API_KEY) return new GeminiProvider();
  if (process.env.OPENAI_API_KEY) return new OpenAIProvider();
  throw new Error("Set ANTHROPIC_API_KEY, GOOGLE_API_KEY, or OPENAI_API_KEY.");
}

function flag(args: string[], name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const [command, target, ...rest] = process.argv.slice(2);

if (command !== "goal" || !target) {
  console.log("Usage: npm run pla -- goal <path-or-url> [--learner id] [--kind job_ad] [--taxonomy id] [--root dir]");
  process.exit(command ? 1 : 0);
}

const learnerId = flag(rest, "learner", "learner_1");
const kind = flag(rest, "kind", "job_ad") as LearnerGoal["kind"];
const taxonomyId = flag(rest, "taxonomy", "skillsfuture_sample");
const rootDir = flag(rest, "root", "LearningAgent");

const provider = pickProvider();
console.log(`Provider: ${provider.name}`);

const goal = target.startsWith("http")
  ? await ingestGoalUrl(learnerId, kind, target)
  : ingestGoalText(learnerId, kind, await readFile(target, "utf8"));
console.log(`Ingested goal ${goal.goal_id} (${goal.raw_text.length} chars, source: ${goal.source.type})`);

const cache = await new TaxonomyCache(rootDir).load(taxonomyId);
console.log(`Taxonomy: ${cache.taxonomy_id} (${cache.entries.length} cached entries)`);

const result = await goalToGraph(goal, cache, provider, rootDir);

console.log(`\nExtracted ${result.analysis.extracted_skills.length} skills → ${result.skill_graph.gap_status.length} graph nodes:`);
for (const node of result.skill_graph.nodes as Array<{ skill_id: string; concept_type: string; prerequisites: string[] }>) {
  const prereq = node.prerequisites.length ? `  (needs: ${node.prerequisites.join(", ")})` : "";
  console.log(`  - ${node.skill_id} [${node.concept_type}]${prereq}`);
}
console.log(`\nDiagnostics generated: ${result.diagnostics.length}`);
if (result.diagnostic_failures.length) {
  console.log(`Diagnostic failures: ${result.diagnostic_failures.map((f) => f.skill_id).join(", ")}`);
}
console.log(`\nWritten to ${rootDir}/Curriculum/${goal.goal_id}/ and ${rootDir}/Learners/${learnerId}/`);
