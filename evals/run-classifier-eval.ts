/**
 * Runs the classify_concept eval set against a real provider.
 * Provider picked from available API keys (abstraction layer — D9).
 *
 *   npm run eval:classifier
 */
import { readFile } from "node:fs/promises";
import { classifyConcept, ClassificationConsistencyError } from "../src/core/classifier.js";
import { AnthropicProvider, GeminiProvider, OpenAIProvider, LLMProvider } from "../src/llm/provider.js";

function pickProvider(): LLMProvider {
  if (process.env.ANTHROPIC_API_KEY) return new AnthropicProvider();
  if (process.env.GOOGLE_API_KEY) return new GeminiProvider();
  if (process.env.OPENAI_API_KEY) return new OpenAIProvider();
  throw new Error("Set ANTHROPIC_API_KEY, GOOGLE_API_KEY, or OPENAI_API_KEY to run the eval.");
}

const evalFile = new URL("./concept-classification.json", import.meta.url);
const { cases } = JSON.parse(await readFile(evalFile, "utf8")) as {
  cases: Array<{ concept: string; expected: string }>;
};

const provider = pickProvider();
console.log(`Provider: ${provider.name}\n`);

let correct = 0;
const failures: string[] = [];

for (const c of cases) {
  try {
    const result = await classifyConcept(c.concept, provider);
    const hit = result.concept_type === c.expected;
    if (hit) correct++;
    else failures.push(`MISS  "${c.concept}"\n      expected ${c.expected}, got ${result.concept_type} — ${result.rationale}`);
    console.log(`${hit ? "PASS" : "MISS"}  ${c.concept} → ${result.concept_type}`);
  } catch (err) {
    const tag = err instanceof ClassificationConsistencyError ? "INCONSISTENT" : "ERROR";
    failures.push(`${tag}  "${c.concept}": ${(err as Error).message}`);
    console.log(`${tag}  ${c.concept}`);
  }
}

console.log(`\n${correct}/${cases.length} correct (${((100 * correct) / cases.length).toFixed(0)}%)`);
if (failures.length) {
  console.log("\nFailures:\n" + failures.join("\n"));
  process.exitCode = 1;
}
