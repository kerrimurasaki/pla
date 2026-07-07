import { mkdtemp, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ingestGoalText, htmlToText } from "../src/pipeline/goalIngestion.js";
import { extractSkills, GroundingError } from "../src/pipeline/skillExtraction.js";
import { mapToTaxonomy, TaxonomyIntegrityError } from "../src/core/taxonomy.js";
import { generateDiagnostic, DiagnosticGenerationError } from "../src/pipeline/diagnostics.js";
import { goalToGraph } from "../src/pipeline/goalToGraph.js";
import { MockProvider } from "../src/llm/provider.js";
import { SkillDefinition } from "../src/schemas/skill.js";
import { TaxonomyCacheFile } from "../src/schemas/taxonomy.js";

const JOB_AD =
  "Valuation Analyst wanted. You will build DCF valuation models for mid-market deals " +
  "and recommend valuation approaches to clients across sectors.";

const taxonomyCache: TaxonomyCacheFile = TaxonomyCacheFile.parse({
  taxonomy_id: "skillsfuture_sample",
  source_url: "https://www.skillsfuture.gov.sg/skills-framework (sample fixture)",
  cached_at: "2026-07-01T00:00:00Z",
  entries: [
    { taxonomy_id: "skillsfuture_sample", ref: "FIN-VAL-3001", title: "Business Valuation", description: "Apply valuation methodologies including DCF" },
    { taxonomy_id: "skillsfuture_sample", ref: "FIN-ADV-4002", title: "Client Advisory", description: "Advise clients on financial decisions" },
  ],
});

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

const extractionResponse = JSON.stringify({
  skills: [
    {
      name: "Build DCF valuation models",
      description: "Construct discounted cash flow models",
      evidence_quote: "build DCF valuation models for mid-market deals",
    },
    {
      name: "Recommend valuation approaches to clients",
      description: "Judge which valuation approach fits a given deal and defend it",
      evidence_quote: "recommend valuation approaches to clients across sectors",
    },
  ],
});

const classifyDcf = JSON.stringify({
  concept: "Build DCF valuation models",
  concept_type: "cognitive_routine",
  four_question_test: fourNo,
  rationale: "Determinate multi-step procedure.",
});

const classifyRecommend = JSON.stringify({
  concept: "Recommend valuation approaches to clients",
  concept_type: "ill_structured_composite",
  four_question_test: fourYes,
  rationale: "Experts disagree; relevant features shift per deal.",
  component_skills: [
    { name: "WACC calculation", concept_type: "cognitive_routine" },
    { name: "Comparable company analysis", concept_type: "cognitive_routine" },
  ],
});

const prereqResponse = JSON.stringify({
  prerequisites: {
    build_dcf_valuation_models: ["wacc_calculation"],
    // F5 regression: the model lists the composite's own component as its
    // prerequisite — the builder must strip it (already linked via components).
    recommend_valuation_approaches_to_clients: ["wacc_calculation"],
  },
});

const mappingResponse = JSON.stringify({
  mapping: [
    { skill_name: "Build DCF valuation models", taxonomy_ref: "FIN-VAL-3001", confidence: 0.9 },
    { skill_name: "Recommend valuation approaches to clients", taxonomy_ref: "FIN-ADV-4002", confidence: 0.7 },
  ],
});

const judgePass = JSON.stringify({
  requires_doing_not_describing: true,
  solvable_without_skill: false,
  response_is_concrete: true,
  reasons: [],
});

const judgeFailDescribing = JSON.stringify({
  requires_doing_not_describing: false,
  solvable_without_skill: true,
  response_is_concrete: true,
  reasons: ["Item asks the learner to describe steps rather than perform the skill on a concrete instance"],
});

const diagnosticResponse = (n: number) =>
  JSON.stringify({
    stimulus: `Novel production task ${n}: compute the required value from these fresh inputs.`,
    correct_response: "42.5",
    skill_requirement: "Must execute the full procedure on unseen numbers",
    shortcut_check: {
      pattern_matching_possible: false,
      process_of_elimination_possible: false,
      memorization_possible: false,
    },
    common_errors: [
      {
        error: "Uses pre-tax cost of debt",
        diagnosis: "Skips the tax shield adjustment",
        feedback:
          "You used the pre-tax cost of debt. Debt interest is tax-deductible, so multiply by (1 - tax rate) before weighting.",
      },
    ],
  });

describe("Goal ingestion (provenance — Invariant 4)", () => {
  it("records pasted-text provenance", () => {
    const goal = ingestGoalText("alice", "job_ad", JOB_AD);
    expect(goal.source.type).toBe("pasted_text");
    expect(goal.raw_text).toContain("DCF");
  });

  it("strips HTML to text", () => {
    expect(htmlToText("<div><h1>Analyst</h1><script>x()</script><p>build &amp; ship</p></div>")).toBe(
      "Analyst build & ship"
    );
  });
});

describe("Skill extraction (grounded in verbatim goal spans)", () => {
  it("accepts skills whose evidence quotes are verbatim spans", async () => {
    const goal = ingestGoalText("alice", "job_ad", JOB_AD);
    const analysis = await extractSkills(goal, new MockProvider([extractionResponse]));
    expect(analysis.extracted_skills).toHaveLength(2);
  });

  it("REJECTS skills the goal text does not evidence (after feeding the rejection back once)", async () => {
    const goal = ingestGoalText("alice", "job_ad", JOB_AD);
    const hallucinated = JSON.stringify({
      skills: [
        {
          name: "Kubernetes administration",
          description: "Run clusters",
          evidence_quote: "manage Kubernetes clusters at scale",
        },
      ],
    });
    await expect(extractSkills(goal, new MockProvider([hallucinated, hallucinated]))).rejects.toThrow(
      GroundingError
    );
  });

  it("REJECTS single-word evidence quotes — heading extraction, not capability extraction (F3)", async () => {
    const goal = ingestGoalText("alice", "job_ad", JOB_AD);
    const headings = JSON.stringify({
      skills: [
        { name: "Valuation", description: "Valuation work", evidence_quote: "valuation" },
      ],
    });
    await expect(extractSkills(goal, new MockProvider([headings, headings]))).rejects.toThrow(
      /single word/
    );
  });
});

describe("Taxonomy mapping (refs never invented — D9)", () => {
  const skills = [
    { name: "Build DCF valuation models", description: "d", evidence_quote: "q" },
  ];

  it("accepts refs that exist in the cache", async () => {
    const resp = JSON.stringify({
      mapping: [{ skill_name: "Build DCF valuation models", taxonomy_ref: "FIN-VAL-3001", confidence: 0.9 }],
    });
    const mapping = await mapToTaxonomy(skills, taxonomyCache, new MockProvider([resp]));
    expect(mapping[0].taxonomy_ref).toBe("FIN-VAL-3001");
  });

  it("REJECTS invented taxonomy refs", async () => {
    const resp = JSON.stringify({
      mapping: [{ skill_name: "Build DCF valuation models", taxonomy_ref: "FAKE-9999", confidence: 0.9 }],
    });
    await expect(mapToTaxonomy(skills, taxonomyCache, new MockProvider([resp]))).rejects.toThrow(
      TaxonomyIntegrityError
    );
  });

  it("fills unmapped skills with an honest null", async () => {
    const resp = JSON.stringify({ mapping: [] });
    const mapping = await mapToTaxonomy(skills, taxonomyCache, new MockProvider([resp]));
    expect(mapping[0]).toEqual({ skill_name: "Build DCF valuation models", taxonomy_ref: null, confidence: 0 });
  });
});

describe("Diagnostic generation (generate → validate → present)", () => {
  const waccSkill = SkillDefinition.parse({
    skill_id: "wacc_calculation",
    name: "WACC calculation",
    description: "Weighted average cost of capital",
    concept_type: "cognitive_routine",
    mastery_criteria: { threshold: 0.85, required_consecutive: 5 },
  });

  it("refuses to generate items for composites — components only (D4)", async () => {
    const composite = SkillDefinition.parse({
      skill_id: "x",
      name: "x",
      description: "x",
      concept_type: "ill_structured_composite",
      component_skill_ids: ["wacc_calculation"],
      mastery_criteria: { threshold: 0.85, required_consecutive: 5 },
    });
    await expect(generateDiagnostic(composite, new MockProvider([]))).rejects.toThrow(
      DiagnosticGenerationError
    );
  });

  it("retries once with the validator's errors, then succeeds (judged on the valid attempt)", async () => {
    const bad = JSON.stringify({
      ...JSON.parse(diagnosticResponse(1)),
      shortcut_check: {
        pattern_matching_possible: true,
        process_of_elimination_possible: false,
        memorization_possible: false,
      },
    });
    const item = await generateDiagnostic(
      waccSkill,
      new MockProvider([bad, diagnosticResponse(1), judgePass])
    );
    expect(item.skill_id).toBe("wacc_calculation");
  });

  it("fails after exhausting attempts on invariant-violating items", async () => {
    const bad = JSON.stringify({
      ...JSON.parse(diagnosticResponse(1)),
      common_errors: [{ error: "e", diagnosis: "d", feedback: "Try again." }],
    });
    await expect(generateDiagnostic(waccSkill, new MockProvider([bad, bad]))).rejects.toThrow(
      /invariant-compliant/
    );
  });

  it("ADVERSARIAL JUDGE (F1): a describe-not-do item is rejected and regenerated", async () => {
    const item = await generateDiagnostic(
      waccSkill,
      new MockProvider([diagnosticResponse(1), judgeFailDescribing, diagnosticResponse(2), judgePass])
    );
    expect(item.stimulus).toContain("task 2"); // the regenerated item, not the judged-out one
  });

  it("PLACEHOLDER CHECK (F2): bracketed template responses are rejected deterministically", async () => {
    const templated = JSON.stringify({
      ...JSON.parse(diagnosticResponse(1)),
      correct_response: "The key requirements identified are: [list of requirements].",
    });
    await expect(generateDiagnostic(waccSkill, new MockProvider([templated, templated]))).rejects.toThrow(
      /placeholder/
    );
  });
});

describe("goalToGraph end-to-end (Phase 2 deliverable)", () => {
  it("job ad → typed, gap-marked graph + diagnostics, persisted per file architecture", async () => {
    const root = await mkdtemp(join(tmpdir(), "pla-p2-"));
    const goal = ingestGoalText("alice", "job_ad", JOB_AD);
    const provider = new MockProvider([
      extractionResponse,
      classifyDcf,
      classifyRecommend,
      prereqResponse,
      mappingResponse,
      // Diagnostics run concurrently: the three generations are issued
      // first (node order), then the three adversarial judge calls.
      diagnosticResponse(1), // build_dcf_valuation_models
      diagnosticResponse(2), // wacc_calculation
      diagnosticResponse(3), // comparable_company_analysis
      judgePass,
      judgePass,
      judgePass,
    ]);

    const result = await goalToGraph(goal, taxonomyCache, provider, root);

    // Typed graph: composite decomposed into real component nodes.
    const ids = result.skill_graph.gap_status.map((g) => g.skill_id).sort();
    expect(ids).toEqual([
      "build_dcf_valuation_models",
      "comparable_company_analysis",
      "recommend_valuation_approaches_to_clients",
      "wacc_calculation",
    ]);

    // Gap-marked: everything starts unverified; the build itself proves nothing.
    expect(result.skill_graph.gap_status.every((g) => g.status === "unverified")).toBe(true);

    // Diagnostics only for well-structured nodes (3 of 4).
    expect(result.diagnostics).toHaveLength(3);
    expect(result.diagnostic_failures).toHaveLength(0);

    // Taxonomy mapping flows into the profile.
    expect(result.profile.taxonomy_mapping["Build DCF valuation models"]).toBe("FIN-VAL-3001");

    // Persisted per the file architecture.
    const curr = join(root, "Curriculum", goal.goal_id);
    expect(existsSync(join(curr, "original.txt"))).toBe(true);
    expect(existsSync(join(curr, "analysis.json"))).toBe(true);
    expect(existsSync(join(curr, "skill_graph.json"))).toBe(true);
    expect(existsSync(join(root, "Learners", "alice", "profile.json"))).toBe(true);
    expect(existsSync(join(root, "Skills", "wacc_calculation", "definition.json"))).toBe(true);

    // Prerequisite edge survived into the persisted graph.
    const persisted = JSON.parse(await readFile(join(curr, "skill_graph.json"), "utf8"));
    const dcfNode = persisted.nodes.find((n: any) => n.skill_id === "build_dcf_valuation_models");
    expect(dcfNode.prerequisites).toEqual(["wacc_calculation"]);

    // F5: the composite's own component was proposed as its prerequisite —
    // stripped, because components are already linked.
    const composite = persisted.nodes.find(
      (n: any) => n.skill_id === "recommend_valuation_approaches_to_clients"
    );
    expect(composite.prerequisites).toEqual([]);
    expect(composite.component_skill_ids).toContain("wacc_calculation");
  });
});
