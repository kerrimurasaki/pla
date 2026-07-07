import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { EventLog, TierViolationError, deriveMasteryView } from "../src/core/eventLog.js";
import { MasteryEventInput } from "../src/schemas/events.js";
import { SkillDefinition } from "../src/schemas/skill.js";

let root: string;
let log: EventLog;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pla-"));
  log = new EventLog(root);
});

function input(overrides: Partial<MasteryEventInput> = {}): MasteryEventInput {
  return {
    event_id: crypto.randomUUID(),
    learner_id: "alice",
    skill_id: "wacc",
    event_type: "practice_item",
    tier: 2,
    item_ref: "item_1",
    response_ref: "resp_1",
    assessment_ref: "assess_1",
    correct: true,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

const waccSkill: SkillDefinition = SkillDefinition.parse({
  skill_id: "wacc",
  name: "WACC calculation",
  description: "Weighted average cost of capital",
  concept_type: "cognitive_routine",
  mastery_criteria: { threshold: 0.85, required_consecutive: 5 },
});

describe("EventLog (append-only, hash-chained — D7)", () => {
  it("appends events and produces a verifying chain", async () => {
    await log.append(input({ event_id: "e1" }));
    await log.append(input({ event_id: "e2", correct: false }));
    await log.append(input({ event_id: "e3" }));
    const v = await log.verify("alice", "wacc");
    expect(v).toEqual({ valid: true, length: 3 });
  });

  it("REJECTS Tier 3 events — telemetry never touches mastery (Invariant 3)", async () => {
    await expect(log.append(input({ tier: 3 }))).rejects.toThrow(TierViolationError);
  });

  it("storage is JSONL append — history is never rewritten", async () => {
    const e1 = await log.append(input({ event_id: "e1" }));
    await log.append(input({ event_id: "e2" }));
    const raw = await readFile(join(root, "Learners", "alice", "events", "wacc.log.jsonl"), "utf8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).event_hash).toBe(e1.event_hash);
  });
});

describe("deriveMasteryView (mastery.json is a derived view — log wins)", () => {
  it("computes level, consecutive streak and eligibility for well-structured skills", async () => {
    // 3 wrong then 17 right in the window: level 17/20; consecutive 17.
    for (let i = 0; i < 3; i++) await log.append(input({ event_id: `w${i}`, correct: false }));
    for (let i = 0; i < 17; i++) await log.append(input({ event_id: `r${i}`, correct: true }));
    const view = deriveMasteryView(await log.read("alice", "wacc"), waccSkill);
    expect(view.mastery_state.current_level).toBe(0.85);
    expect(view.mastery_state.consecutive_correct).toBe(17);
    expect(view.mastery_state.credential_eligible).toBe(true);
  });

  it("an error resets the consecutive streak", async () => {
    for (let i = 0; i < 4; i++) await log.append(input({ event_id: `a${i}`, correct: true }));
    await log.append(input({ event_id: "bad", correct: false }));
    await log.append(input({ event_id: "z", correct: true }));
    const view = deriveMasteryView(await log.read("alice", "wacc"), waccSkill);
    expect(view.mastery_state.consecutive_correct).toBe(1);
    expect(view.mastery_state.credential_eligible).toBe(false);
  });

  it("ill-structured eligibility = 3 dimensions + same-case revisit + passed defense (D3, tunable D8)", async () => {
    const composite = SkillDefinition.parse({
      skill_id: "valuation_method_selection",
      name: "Choosing a valuation approach",
      description: "Judgment skill",
      concept_type: "ill_structured_composite",
      component_skill_ids: ["wacc"],
      mastery_criteria: {
        threshold: 0.85,
        required_consecutive: 5,
        criss_crossing: {
          min_disciplinary_dimensions: 3,
          min_same_case_revisits_different_lens: 1,
          oral_defense_required: true,
        },
      },
    });
    const skillId = "valuation_method_selection";
    const caseEvent = (id: string, dim: string, caseId: string): MasteryEventInput =>
      input({ event_id: id, skill_id: skillId, event_type: "case_task", tier: 2, passed: true, disciplinary_dimension: dim, case_id: caseId });

    await log.append(caseEvent("c1", "finance", "acme"));
    await log.append(caseEvent("c2", "operations", "acme")); // same case, different lens
    await log.append(caseEvent("c3", "legal_ethics", "biotech_jv"));

    let view = deriveMasteryView(await log.read("alice", skillId), composite);
    expect(view.dimensional_coverage?.dimensions_produced.sort()).toEqual(["finance", "legal_ethics", "operations"]);
    expect(view.dimensional_coverage?.same_case_revisit_different_lens).toBe(true);
    expect(view.mastery_state.credential_eligible).toBe(false); // no defense yet

    await log.append(
      input({ event_id: "d1", skill_id: skillId, event_type: "oral_defense", tier: 1, passed: true })
    );
    view = deriveMasteryView(await log.read("alice", skillId), composite);
    expect(view.dimensional_coverage?.oral_defense_passed).toBe(true);
    expect(view.mastery_state.credential_eligible).toBe(true);
  });
});
