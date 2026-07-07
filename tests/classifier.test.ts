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

describe("classify_concept (six types + four-question routing test — D4)", () => {
  it("accepts a consistent well-structured classification", async () => {
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
  });

  it("accepts a consistent composite WITH decomposition", async () => {
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
    await expect(classifyConcept("long division", provider)).rejects.toThrow(
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
    await expect(classifyConcept("diagnosing team underperformance", provider)).rejects.toThrow(
      ClassificationConsistencyError
    );
  });

  it("REJECTS composites missing decomposition (decomposition duty)", async () => {
    const provider = new MockProvider([
      JSON.stringify({
        concept: "negotiation",
        concept_type: "ill_structured_composite",
        four_question_test: fourYes,
        rationale: "Judgment skill.",
      }),
    ]);
    await expect(classifyConcept("negotiation", provider)).rejects.toThrow(/decomposition/);
  });

  it("rejects components classified as composites (schema constraint)", async () => {
    const provider = new MockProvider([
      JSON.stringify({
        concept: "strategy",
        concept_type: "ill_structured_composite",
        four_question_test: fourYes,
        rationale: "Judgment skill.",
        component_skills: [{ name: "sub-strategy", concept_type: "ill_structured_composite" }],
      }),
    ]);
    await expect(classifyConcept("strategy", provider)).rejects.toThrow();
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
