import { ZodError } from "zod";
import {
  ConceptClassification,
  routesToCaseEngine,
  fourQuestionYesCount,
} from "../schemas/concept.js";
import { LLMProvider } from "../llm/provider.js";
import { extractJson } from "../util/json.js";

const SYSTEM = `You classify skills/concepts for an evidence-based learning system into exactly SIX types.

Five Engelmann-Carnine types (well-structured — determinate correct responses, stable critical features):
1. single_dimension_non_comparative — absolute value, precise boundary; something IS or IS NOT an instance (horizontal, between, the letter "b").
2. noun — multi-feature category membership with fuzzy boundaries (dog, vehicle, sentence).
3. comparative — relative value requiring a reference point; degree or change (steeper, heavier, "got warmer").
4. cognitive_routine — multi-step mental procedure with a determinate correct execution path (long division, WACC calculation, decoding words).
5. correlated_features — if-then relationships; when X is present, Y follows (singular subject → verb takes -s).

Sixth type (routing classification, ill-structured):
6. ill_structured_composite — judgment/assembly skill; no single correct answer; relevant features shift per case; a fixed procedure faithfully executed would sometimes fail; competence = assembling well-structured component skills differently per situation (choosing a valuation approach, diagnosing team underperformance, strategy formulation).

Answer the four-question routing test HONESTLY for every concept:
1. Do qualified experts disagree on the best answer while converging on which answers are indefensible?
2. Does the set of relevant features shift between instances?
3. Would a fixed procedure, executed faithfully, sometimes yield a wrong or badly incomplete answer?
4. Does competent performance require combining multiple already-defined skills differently per situation?

Boundary discipline: difficulty and step count are NOT the dividing line. Long division is twelve steps and well-structured. "Is this acquisition a good idea" is one question and ill-structured. Essay structure is a cognitive routine; "identify the thesis statement" is a non-comparative.

If (and only if) you classify as ill_structured_composite, decompose into well-structured component skills.
HARD RULE for component_skills: every component's concept_type MUST be one of the FIVE classic type ids — NEVER ill_structured_composite. If a component still feels like a judgment skill, keep decomposing until you reach concretely teachable classic-type skills (procedures, discriminations, categories, comparatives, if-then rules). List those.

Respond with ONLY a JSON object:
{
  "concept": "<the concept>",
  "concept_type": "<one of the six type ids>",
  "four_question_test": {
    "experts_disagree_on_best_converge_on_indefensible": bool,
    "relevant_features_shift_between_instances": bool,
    "fixed_procedure_would_sometimes_fail": bool,
    "requires_recombining_component_skills_per_situation": bool
  },
  "rationale": "<1-3 sentences>",
  "component_skills": [{"name": "...", "concept_type": "<one of the five classic type ids>"}]  // only for ill_structured_composite
}`;

export class ClassificationConsistencyError extends Error {}

function readableError(err: unknown): string {
  if (err instanceof ZodError) {
    return err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * classify_concept (Phase 1). LLM proposes; the four-question test is then
 * enforced deterministically: the routing decision must agree with the
 * test answers. Disagreement is surfaced, never silently accepted —
 * misrouting in either direction is a pedagogical failure.
 *
 * Invalid outputs (schema violations like composite-typed components, or
 * internally inconsistent classifications) are retried with the rejection
 * reason fed back to the model — same pattern as the authoring generators.
 * First real-provider run (2026-07-07) hit exactly this: a component typed
 * ill_structured_composite, refused by the schema per D4.
 */
export async function classifyConcept(
  description: string,
  provider: LLMProvider,
  maxAttempts = 3
): Promise<ConceptClassification> {
  let lastError = "";
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const raw = await provider.complete({
      system: SYSTEM,
      prompt:
        `Classify this concept/skill: ${description}` +
        (lastError
          ? `\n\nYour previous classification was rejected:\n${lastError}\nFix this and reclassify. ` +
            `Remember: component_skills entries must use one of the five classic type ids, never ill_structured_composite.`
          : ""),
      json: true,
      temperature: 0,
    });

    try {
      const parsed = ConceptClassification.parse(JSON.parse(extractJson(raw)));

      const shouldBeComposite = routesToCaseEngine(parsed.four_question_test);
      const isComposite = parsed.concept_type === "ill_structured_composite";

      if (shouldBeComposite !== isComposite) {
        throw new ClassificationConsistencyError(
          `Classification of "${description}" is internally inconsistent: ` +
            `four-question test says ${fourQuestionYesCount(parsed.four_question_test)}/4 yes ` +
            `(routes to ${shouldBeComposite ? "case engine" : "DI machinery"}) but type is ` +
            `${parsed.concept_type}. Re-run or escalate — do not misroute.`
        );
      }

      if (isComposite && (!parsed.component_skills || parsed.component_skills.length === 0)) {
        throw new ClassificationConsistencyError(
          `"${description}" classified ill_structured_composite without decomposition — ` +
            "decomposition duty (D4) requires component skills classified under the five classic types."
        );
      }

      return parsed;
    } catch (err) {
      lastError = readableError(err);
    }
  }
  throw new ClassificationConsistencyError(
    `Could not classify "${description}" after ${maxAttempts} attempts. Last rejection: ${lastError}`
  );
}
