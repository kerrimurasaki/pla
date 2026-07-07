import { describe, expect, it } from "vitest";
import { classifyConcept, ClassificationConsistencyError } from "../src/core/classifier.js";
import { MockProvider } from "../src/llm/provider.js";
import { routesToCaseEngine } from "../src/schemas/concept.js";

const fourNo = {
  experts_disagree_on_best_converge_on_indefensible: false,
  relevant_features_shift_between_instances: false,
  fixed_procedure_would_sometimes_fail: false,
  requires_recombining_component_skills_per_situation: false,
};
const fourYes = {
  experts_disagree_on_best_converge_on_indefensible: true,
  relevant_features_shift_between_instances: true,
  fixed_procedure_would_sometimes_fail: true,
  requires_recombining_component_skills_per_situation: true,
};

describe("classify_concept (two-pass: classification + decomposition — D4)", () => {
  it("accepts a consistent well-structured classification (one call)", async () => {
    const provider = new MockProvider([
      JSON.stringify({
        concept: "long division",
        concept_type: "cognitive_routine",
        four_question_test: fourNo,
        rationale: "Determinate execution path; twelve steps but well-structured.",
      }),
    ]);
    const result = await classifyConcept("long division", provider);
    expect(result.concept_type).toBe("cognitive_routine");
    expect(result.component_skills).toBeUndefined();
  });

  it("accepts a composite whose pass-1 sketch is fully classic-typed (one call, no pass 2)", async () => {
    const provider = new MockProvider([
      JSON.stringify({
        concept: "choosing a valuation approach",
        concept_type: "ill_structured_composite",
        four_question_test: fourYes,
        rationale: "Experts disagree; features shift per deal.",
        component_skills: [
          { name: "WACC calculation", concept_type: "cognitive_routine" },
          { name: "DCF mechanics", concept_type: "cognitive_routine" },
        ],
      }),
    ]);
    const result = await classifyConcept("choosing a valuation approach", provider);
    expect(result.concept_type).toBe("ill_structured_composite");
    expect(result.component_skills).toHaveLength(2);
  });

  it("REJECTS a composite classification whose four-question test says well-structured (misrouting)", async () => {
    const provider = new MockProvider([
      JSON.stringify({
        concept: "long division",
        concept_type: "ill_structured_composite",
        four_question_test: fourNo,
        rationale: "It felt hard.",
        component_skills: [{ name: "subtraction", concept_type: "cognitive_routine" }],
      }),
    ]);
    await expect(classifyConcept("long division", provider, 1)).rejects.toThrow(
      ClassificationConsistencyError
    );
  });

  it("REJECTS a well-structured classification whose test says ill-structured (checklist theater)", async () => {
    const provider = new MockProvider([
      JSON.stringify({
        concept: "diagnosing team underperformance",
        concept_type: "cognitive_routine",
        four_question_test: fourYes,
        rationale: "I made a checklist.",
      }),
    ]);
    await expect(classifyConcept("diagnosing team underperformance", provider, 1)).rejects.toThrow(
      ClassificationConsistencyError
    );
  });

  it("composite WITHOUT inline components triggers the dedicated decomposition pass", async () => {
    const provider = new MockProvider([
      JSON.stringify({
        concept: "negotiation",
        concept_type: "ill_structured_composite",
        four_question_test: fourYes,
        rationale: "Judgment skill.",
      }),
      JSON.stringify({
        component_skills: [
          { name: "computing a BATNA reservation price", concept_type: "cognitive_routine" },
          { name: "identifying anchoring in an offer", concept_type: "single_dimension_non_comparative" },
        ],
      }),
    ]);
    const result = await classifyConcept("negotiation", provider);
    expect(result.component_skills).toHaveLength(2);
  });

  it("REGRESSION (production 2026-07-07): judgment-typed component is repaired by the decomposition pass, not retried to death", async () => {
    // Pass 1: model insists component #2 is itself a judgment skill — this
    // exhausted 3 whole-classification retries in production.
    const pass1 = JSON.stringify({
      concept: "Post-Implementation Review",
      concept_type: "ill_structured_composite",
      four_question_test: fourYes,
      rationale: "Outcome evaluation is contested and context-dependent.",
      component_skills: [
        { name: "computing variance vs baseline metrics", concept_type: "cognitive_routine" },
        { name: "stakeholder outcome assessment", concept_type: "ill_structured_composite" },
      ],
    });
    // Pass 2: focused repair, keeping the valid component, replacing the judgment one.
    const decompose = JSON.stringify({
      component_skills: [
        { name: "computing variance vs baseline metrics", concept_type: "cognitive_routine" },
        { name: "writing measurable success criteria", concept_type: "cognitive_routine" },
        { name: "identifying leading vs lagging indicators", concept_type: "noun" },
      ],
    });
    const result = await classifyConcept("Post-Implementation Review", new MockProvider([pass1, decompose]));
    expect(result.concept_type).toBe("ill_structured_composite");
    expect(result.component_skills!.map((c) => c.name)).toContain("writing measurable success criteria");
    expect(result.component_skills!.map((c) => c.name)).not.toContain("stakeholder outcome assessment");
  });

  it("exhausted decomposition retries surface a readable error, not raw Zod JSON", async () => {
    const pass1 = JSON.stringify({
      concept: "strategy",
      concept_type: "ill_structured_composite",
      four_question_test: fourYes,
      rationale: "Judgment skill.",
    });
    const badDecompose = JSON.stringify({
      component_skills: [
        { name: "sub-strategy", concept_type: "ill_structured_composite" },
        { name: "vision setting", concept_type: "ill_structured_composite" },
      ],
    });
    await expect(
      classifyConcept("strategy", new MockProvider([pass1, badDecompose, badDecompose]), 2)
    ).rejects.toThrow(/component_skills\.0\.concept_type: Components of an ill_structured_composite/);
  });

  it("parses JSON wrapped in markdown fences", async () => {
    const provider = new MockProvider([
      "```json\n" +
        JSON.stringify({
          concept: "horizontal",
          concept_type: "single_dimension_non_comparative",
          four_question_test: fourNo,
          rationale: "Absolute boundary.",
        }) +
        "\n```",
    ]);
    const result = await classifyConcept("horizontal", provider);
    expect(result.concept_type).toBe("single_dimension_non_comparative");
  });

  it("routing threshold: 3 of 4 yes routes to the case engine", () => {
    expect(routesToCaseEngine({ ...fourYes, fixed_procedure_would_sometimes_fail: false })).toBe(true);
    expect(
      routesToCaseEngine({
        ...fourNo,
        experts_disagree_on_best_converge_on_indefensible: true,
        relevant_features_shift_between_instances: true,
      })
    ).toBe(false);
  });
});
