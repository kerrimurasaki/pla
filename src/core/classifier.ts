import { z, ZodError } from "zod";
import {
  ClassicComponentSkill,
  ConceptClassification,
  ConceptType,
  routesToCaseEngine,
  fourQuestionYesCount,
} from "../schemas/concept.js";
import { LLMProvider } from "../llm/provider.js";
import { extractJson } from "../util/json.js";

const CLASSIFY_SYSTEM = `You classify skills/concepts for an evidence-based learning system into exactly SIX types.

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

If you classify as ill_structured_composite you MAY sketch component_skills, but each component's concept_type must be one of the FIVE classic type ids — never ill_structured_composite. (If unsure, omit component_skills; decomposition happens in a dedicated pass.)

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
  "component_skills": [{"name": "...", "concept_type": "<classic type id>"}]  // optional, composites only
}`;

const DECOMPOSE_SYSTEM = `You decompose an ill-structured judgment skill into its WELL-STRUCTURED component skills.

The five classic type ids: single_dimension_non_comparative, noun, comparative, cognitive_routine, correlated_features.

Hard rules:
- Every component's concept_type MUST be one of the five ids above. NEVER ill_structured_composite.
- A component is concretely teachable with a determinate correct execution: a procedure, a discrimination, a category, a comparative judgment against a reference, or an if-then rule.
- If a candidate component is itself a judgment skill ("stakeholder management", "communicating effectively"), do NOT list it — list the teachable classic-type skills inside it instead (e.g. "constructing a stakeholder analysis matrix" (cognitive_routine), "identifying decision-maker vs influencer roles" (noun)).
- 2 to 8 components.

Respond with ONLY JSON:
{ "component_skills": [ { "name": "...", "concept_type": "<one of the five ids>" } ] }`;

export class ClassificationConsistencyError extends Error {}

/**
 * Pass-1 schema is LENIENT about component types (plain six-type enum) so a
 * composite-typed component doesn't fail the whole classification — it just
 * routes that component into the dedicated decomposition pass.
 */
const Pass1Schema = ConceptClassification.omit({ component_skills: true }).extend({
  component_skills: z
    .array(z.object({ name: z.string(), concept_type: ConceptType }))
    .optional(),
});
type Pass1 = z.infer<typeof Pass1Schema>;

const DecompositionSchema = z.object({
  component_skills: z.array(ClassicComponentSkill).min(2),
});

function readableError(err: unknown): string {
  if (err instanceof ZodError) {
    return err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * classify_concept (Phase 1, restructured 2026-07-07 after real-provider
 * failures): TWO passes.
 *
 * Pass 1 — classification. The four-question test is enforced
 * deterministically: the routing decision must agree with the test answers;
 * inconsistency is retried with the reason fed back, never silently accepted.
 *
 * Pass 2 — decomposition (composites only). If pass 1 already sketched
 * components and they are all classic-typed, they are accepted (one call
 * total). Otherwise a dedicated decomposition prompt runs, told exactly
 * which candidate components were judgment skills and instructed to replace
 * each with the teachable classic-type skills inside it. Real models proved
 * unable to fix this via whole-classification retries (exhausted 3 attempts
 * in production); the focused repair pass is the fix.
 */
export async function classifyConcept(
  description: string,
  provider: LLMProvider,
  maxAttempts = 3
): Promise<ConceptClassification> {
  let lastError = "";
  let pass1: Pass1 | null = null;

  for (let attempt = 0; attempt < maxAttempts && !pass1; attempt++) {
    const raw = await provider.complete({
      system: CLASSIFY_SYSTEM,
      prompt:
        `Classify this concept/skill: ${description}` +
        (lastError ? `\n\nYour previous classification was rejected:\n${lastError}\nFix this and reclassify.` : ""),
      json: true,
      temperature: 0,
    });

    try {
      const parsed = Pass1Schema.parse(JSON.parse(extractJson(raw)));

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
      pass1 = parsed;
    } catch (err) {
      lastError = readableError(err);
    }
  }

  if (!pass1) {
    throw new ClassificationConsistencyError(
      `Could not classify "${description}" after ${maxAttempts} attempts. Last rejection: ${lastError}`
    );
  }

  if (pass1.concept_type !== "ill_structured_composite") {
    return ConceptClassification.parse({ ...pass1, component_skills: undefined });
  }

  // Decomposition duty (D4). Accept pass-1 components only if fully classic.
  const sketched = pass1.component_skills ?? [];
  const judgmentTyped = sketched.filter((c) => c.concept_type === "ill_structured_composite");
  if (sketched.length >= 2 && judgmentTyped.length === 0) {
    return ConceptClassification.parse(pass1);
  }

  const component_skills = await decomposeComposite(
    description,
    provider,
    {
      keep: sketched.filter(
        (c): c is ClassicComponentSkill => c.concept_type !== "ill_structured_composite"
      ),
      replace: judgmentTyped.map((c) => c.name),
    },
    maxAttempts
  );
  return ConceptClassification.parse({ ...pass1, component_skills });
}

/** Pass 2: focused decomposition with targeted repair feedback. */
async function decomposeComposite(
  description: string,
  provider: LLMProvider,
  hints: { keep: ClassicComponentSkill[]; replace: string[] },
  maxAttempts: number
): Promise<ClassicComponentSkill[]> {
  let lastError =
    hints.replace.length > 0
      ? `These candidate components are judgment skills, not classic types: ` +
        hints.replace.map((n) => `"${n}"`).join(", ") +
        `. Replace each with the concretely teachable classic-type skills inside it.`
      : "";

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const raw = await provider.complete({
      system: DECOMPOSE_SYSTEM,
      prompt:
        `Decompose this judgment skill: ${description}` +
        (hints.keep.length
          ? `\n\nAlready-identified valid components (keep these):\n` +
            hints.keep.map((c) => `- ${c.name} (${c.concept_type})`).join("\n")
          : "") +
        (lastError ? `\n\nPrevious attempt was rejected:\n${lastError}` : ""),
      json: true,
      temperature: 0,
    });

    try {
      return DecompositionSchema.parse(JSON.parse(extractJson(raw))).component_skills;
    } catch (err) {
      lastError = readableError(err);
    }
  }
  throw new ClassificationConsistencyError(
    `Could not decompose "${description}" into classic-type components after ${maxAttempts} attempts. ` +
      `Last rejection: ${lastError}`
  );
}
