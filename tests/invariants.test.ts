import { describe, expect, it } from "vitest";
import {
  validatePracticeItem,
  validateCaseTask,
  validateRoutine,
  validateRoutineRouting,
  validateExampleSequence,
  checkClaimEligibility,
} from "../src/validators/invariants.js";
import { SkillDefinition } from "../src/schemas/skill.js";
import { deriveMasteryView } from "../src/core/eventLog.js";
import { computeEventHash } from "../src/core/hashchain.js";
import { GENESIS_HASH, MasteryEvent } from "../src/schemas/events.js";

const routineSkill = SkillDefinition.parse({
  skill_id: "fraction_multiplication",
  name: "Fraction multiplication",
  description: "Multiply fractions",
  concept_type: "cognitive_routine",
  mastery_criteria: { threshold: 0.85, required_consecutive: 5 },
});

const compositeSkill = SkillDefinition.parse({
  skill_id: "valuation_method_selection",
  name: "Choosing a valuation approach",
  description: "Judgment",
  concept_type: "ill_structured_composite",
  component_skill_ids: ["wacc"],
  mastery_criteria: { threshold: 0.85, required_consecutive: 5 },
});

const goodItem = {
  item_id: "i1",
  skill_id: "identifying_multiplication_problems",
  stimulus: "Tom bought 3 boxes. Each box has 8 crayons. Is this a multiplication problem?",
  correct_response: "Yes",
  skill_requirement: "Must recognize 'each ___ has' pattern indicating equal groups",
  novel: true,
  shortcut_check: {
    pattern_matching_possible: false,
    process_of_elimination_possible: false,
    memorization_possible: false,
  },
  common_errors: [
    {
      error: "Says 'No'",
      diagnosis: "Not recognizing equal groups language",
      feedback:
        "Listen for 'each box has 8' — that's the same number again and again. When you use the same number again and again, it's multiplication.",
    },
  ],
};

describe("Invariant 1 & 3 — practice items", () => {
  it("accepts a compliant production item", () => {
    expect(validatePracticeItem(goodItem).valid).toBe(true);
  });

  it("rejects items a shortcut can solve", () => {
    const bad = { ...goodItem, shortcut_check: { ...goodItem.shortcut_check, memorization_possible: true } };
    const v = validatePracticeItem(bad);
    expect(v.valid).toBe(false);
    expect(v.errors[0]).toContain("Invariant 1");
  });

  it("rejects non-novel test items", () => {
    expect(validatePracticeItem({ ...goodItem, novel: false }).errors[0]).toContain("novel");
  });

  it("rejects bracketed placeholder correct_responses (F2 — first e2e run leak)", () => {
    const bad = {
      ...goodItem,
      correct_response: "The key requirements identified are: [list of requirements].",
    };
    const v = validatePracticeItem(bad);
    expect(v.valid).toBe(false);
    expect(v.errors[0]).toContain("placeholder");
  });

  it("rejects vague feedback ('Try again.')", () => {
    const bad = {
      ...goodItem,
      common_errors: [{ error: "x", diagnosis: "y", feedback: "Try again." }],
    };
    const v = validatePracticeItem(bad);
    expect(v.valid).toBe(false);
  });
});

const goodSource = {
  case_id: "acme_acquisition",
  title: "Acme/Beta acquisition",
  source_url: "https://example.com/case",
  citation: "Smith, J. (2024). The Acme acquisition. Journal of Corporate Finance.",
  retrieved_at: "2026-07-01T00:00:00Z",
  verified_facts: [{ fact: "Deal value was $2.1B", location_in_source: "p.3" }],
};

const goodTask = {
  task_id: "acme_t1",
  case_id: "acme_acquisition",
  segment_ids: ["seg_04"],
  target_concepts: ["valuation_method_selection"],
  prompt: "Recommend and defend a valuation approach for this acquisition.",
  rubric: [
    { indicator: "Identifies the cash-flow stability assumption and tests it against segment evidence", anchored_to: "seg_04" },
    { indicator: "States conditions under which the recommendation would flip", anchored_to: "case_facts" },
  ],
  defense_required: true,
  shortcut_check: { generic_fluency_sufficient: false, note: "Indicators require case facts" },
};

describe("Invariant 1 (case form) & 4 — case tasks", () => {
  it("accepts a grounded, anchored case task", () => {
    expect(validateCaseTask(goodTask, goodSource).valid).toBe(true);
  });

  it("rejects tasks satisfiable by generic fluency", () => {
    const bad = { ...goodTask, shortcut_check: { generic_fluency_sufficient: true, note: "" } };
    expect(validateCaseTask(bad, goodSource).errors[0]).toContain("generic verbal fluency");
  });

  it("rejects ungrounded sources — no fabricated case facts", () => {
    const bad = { ...goodSource, verified_facts: [] };
    const v = validateCaseTask(goodTask, bad);
    expect(v.valid).toBe(false);
    expect(v.errors.join()).toContain("Invariant 4");
  });
});

describe("D4 routing rule — never overtize judgment", () => {
  it("refuses to route ill_structured_composite to the routine generator", () => {
    const v = validateRoutineRouting(compositeSkill);
    expect(v.valid).toBe(false);
    expect(v.errors[0]).toContain("checklist theater");
  });
});

describe("Covertization fade (≤30% per stage — D8 validated constant)", () => {
  const steps = [
    {
      step_number: 1,
      teacher_says: "Read the problem.",
      learner_does: "Reads it.",
      correct_feedback: "Good.",
      error_feedback: "Listen: ... Your turn.",
    },
  ];
  const routine = (perc: number[]) => ({
    skill_id: "fraction_multiplication",
    stages: perc.map((p, i) => ({ skill_id: "fraction_multiplication", stage_id: `S${i}`, percent_overt: p, steps })),
  });

  it("accepts the canonical 100→75→50→25→0 schedule", () => {
    expect(validateRoutine(routine([100, 75, 50, 25, 0]), routineSkill).valid).toBe(true);
  });

  it("rejects fades steeper than 30%", () => {
    const v = validateRoutine(routine([100, 60, 30, 0]), routineSkill);
    expect(v.valid).toBe(false);
    expect(v.errors[0]).toContain("exceeds");
  });

  it("rejects support that increases between stages", () => {
    expect(validateRoutine(routine([100, 75, 90, 60]), routineSkill).valid).toBe(false);
  });
});

describe("Example sequences — juxtaposition blocks, novelty, consistency", () => {
  const seq = {
    skill_id: "horizontal",
    sequence_type: "negative_first",
    wording_template: "Is this line horizontal?",
    examples: [
      { example_id: "e1", kind: "negative", stimulus: "line tilted 2 degrees", expected_response: "No" },
      { example_id: "e2", kind: "positive", stimulus: "perfectly flat line", expected_response: "Yes" },
      { example_id: "e3", kind: "positive", stimulus: "flat line, different length", expected_response: "Yes" },
      { example_id: "e4", kind: "test", stimulus: "line tilted 45 degrees", expected_response: "No" },
    ],
    juxtaposition_blocks: [{ block_id: "b1", example_ids: ["e1", "e2", "e3"] }],
  };

  it("accepts a well-formed sequence", () => {
    expect(validateExampleSequence(seq, routineSkill).valid).toBe(true);
  });

  it("rejects modeled examples outside any juxtaposition block (restart points undefined)", () => {
    const bad = { ...seq, juxtaposition_blocks: [{ block_id: "b1", example_ids: ["e1", "e2"] }] };
    expect(validateExampleSequence(bad, routineSkill).errors[0]).toContain("juxtaposition block");
  });

  it("rejects test examples that repeat modeled stimuli (must be novel)", () => {
    const bad = {
      ...seq,
      examples: seq.examples.map((e) =>
        e.example_id === "e4" ? { ...e, stimulus: "perfectly flat line" } : e
      ),
    };
    expect(validateExampleSequence(bad, routineSkill).errors[0]).toContain("novel");
  });

  it("refuses example sequences for ill_structured_composite skills", () => {
    expect(validateExampleSequence(seq, compositeSkill).valid).toBe(false);
  });
});

describe("Credential gate (Invariant 2 / D7) — gate the claim, not the learner", () => {
  function chained(inputs: Array<Omit<MasteryEvent, "prior_event_hash" | "event_hash">>): MasteryEvent[] {
    const out: MasteryEvent[] = [];
    let prior = GENESIS_HASH;
    for (const i of inputs) {
      const e = { ...i, prior_event_hash: prior, event_hash: "" };
      e.event_hash = computeEventHash(e);
      out.push(e as MasteryEvent);
      prior = e.event_hash;
    }
    return out;
  }

  const wacc = SkillDefinition.parse({
    skill_id: "wacc",
    name: "WACC",
    description: "wacc",
    concept_type: "cognitive_routine",
    mastery_criteria: { threshold: 0.85, required_consecutive: 5 },
  });
  const dcf = SkillDefinition.parse({
    skill_id: "dcf",
    name: "DCF",
    description: "dcf",
    concept_type: "cognitive_routine",
    mastery_criteria: { threshold: 0.85, required_consecutive: 5 },
  });

  const base = (i: number, over: Partial<MasteryEvent> = {}) => ({
    event_id: `e${i}`,
    learner_id: "alice",
    skill_id: "wacc",
    event_type: "practice_item" as const,
    tier: 2 as const,
    item_ref: `it${i}`,
    response_ref: `r${i}`,
    assessment_ref: `a${i}`,
    correct: true,
    timestamp: `2026-07-05T09:00:0${i % 10}Z`,
    ...over,
  });

  it("issues only when every requirement is met, and names what is missing otherwise", () => {
    // Both constituents mastered on production, but no Tier 1, no integrative task.
    const waccEvents = chained([0, 1, 2, 3, 4, 5].map((i) => base(i)));
    const dcfEvents = chained([0, 1, 2, 3, 4, 5].map((i) => base(i, { skill_id: "dcf" })));
    const result = checkClaimEligibility({
      constituent_views: [deriveMasteryView(waccEvents, wacc), deriveMasteryView(dcfEvents, dcf)],
      constituent_skills: [wacc, dcf],
      events_by_skill: { wacc: waccEvents, dcf: dcfEvents },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("No Tier 1 event");
    expect(result.errors.join("\n")).toContain("integrative");

    // Add an integrative Tier 1 case task spanning both constituents.
    const full = chained([
      ...[0, 1, 2, 3, 4, 5].map((i) => base(i)),
      base(6, {
        event_type: "case_task",
        tier: 1,
        passed: true,
        spanned_skill_ids: ["wacc", "dcf"],
      }),
    ]);
    const ok = checkClaimEligibility({
      constituent_views: [deriveMasteryView(full, wacc), deriveMasteryView(dcfEvents, dcf)],
      constituent_skills: [wacc, dcf],
      events_by_skill: { wacc: full, dcf: dcfEvents },
    });
    expect(ok.valid).toBe(true);
  });

  it("rejects bundles containing Tier 3 evidence", () => {
    const events = chained([
      ...[0, 1, 2, 3, 4, 5].map((i) => base(i)),
      base(6, { event_type: "case_task", tier: 1, passed: true, spanned_skill_ids: ["wacc", "dcf"] }),
      base(7, { tier: 3 as 2 }), // simulating imported/foreign evidence
    ]);
    const result = checkClaimEligibility({
      constituent_views: [deriveMasteryView(events, wacc)],
      constituent_skills: [wacc],
      events_by_skill: { wacc: events },
    });
    expect(result.errors.join("\n")).toContain("Tier 3");
  });

  it("rejects claims whose event chain fails verification", () => {
    const events = chained([
      ...[0, 1, 2, 3, 4, 5].map((i) => base(i)),
      base(6, { event_type: "case_task", tier: 1, passed: true, spanned_skill_ids: ["wacc", "dcf"] }),
    ]);
    events[2] = { ...events[2], assessment_ref: "FORGED" };
    const result = checkClaimEligibility({
      constituent_views: [deriveMasteryView(events, wacc)],
      constituent_skills: [wacc],
      events_by_skill: { wacc: events },
    });
    expect(result.errors.join("\n")).toContain("chain fails verification");
  });
});
