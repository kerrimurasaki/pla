import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { authorRoutine, writeRoutine, verifyFrozenStage, AuthoringError } from "../src/authoring/routineAuthor.js";
import { authorExampleSequence } from "../src/authoring/sequenceAuthor.js";
import { MockProvider } from "../src/llm/provider.js";
import { SkillDefinition } from "../src/schemas/skill.js";
import { RoutineStage } from "../src/schemas/instruction.js";

const routineSkill = SkillDefinition.parse({
  skill_id: "fraction_multiplication",
  name: "Fraction multiplication",
  description: "Multiply fractions",
  concept_type: "cognitive_routine",
  mastery_criteria: { threshold: 0.85, required_consecutive: 5 },
});

const compositeSkill = SkillDefinition.parse({
  skill_id: "team_diagnosis",
  name: "Diagnosing team underperformance",
  description: "Judgment skill",
  concept_type: "ill_structured_composite",
  component_skill_ids: ["fraction_multiplication"],
  mastery_criteria: { threshold: 0.85, required_consecutive: 5 },
});

const step = (n: number) => ({
  step_number: n,
  teacher_says: `Direction ${n}.`,
  learner_does: `Response ${n}.`,
  correct_feedback: "Good.",
  error_feedback: `Listen: Response ${n}. Your turn.`,
});

const goodRoutine = JSON.stringify({
  stages: [
    { stage_id: "ORIGINAL", percent_overt: 100, steps: [step(1), step(2)] },
    { stage_id: "A", percent_overt: 75, steps: [step(1)] },
    { stage_id: "B", percent_overt: 50, steps: [step(1)] },
    { stage_id: "C", percent_overt: 25, steps: [step(1)] },
    { stage_id: "INDEPENDENT", percent_overt: 0, steps: [step(1)] },
  ],
});

describe("Routine authoring (generate → validate → freeze — Phase 3)", () => {
  it("authors, freezes (content hashes) and persists a valid routine", async () => {
    const routine = await authorRoutine(routineSkill, new MockProvider([goodRoutine]));
    expect(routine.stages).toHaveLength(5);
    expect(routine.stages.every((s) => !!s.content_hash)).toBe(true);

    const root = await mkdtemp(join(tmpdir(), "pla-p3-"));
    await writeRoutine(routine, root);
    const frozen = RoutineStage.parse(
      JSON.parse(await readFile(join(root, "Skills", "fraction_multiplication", "routine", "stage_ORIGINAL.json"), "utf8"))
    );
    expect(() => verifyFrozenStage(frozen)).not.toThrow();
  });

  it("retries with validator errors on a too-steep fade, then succeeds", async () => {
    const badFade = JSON.stringify({
      stages: [
        { stage_id: "ORIGINAL", percent_overt: 100, steps: [step(1)] },
        { stage_id: "A", percent_overt: 50, steps: [step(1)] }, // 50% drop
      ],
    });
    const routine = await authorRoutine(routineSkill, new MockProvider([badFade, goodRoutine]));
    expect(routine.stages).toHaveLength(5);
  });

  it("REFUSES to author routines for composites before any model call (D4)", async () => {
    await expect(authorRoutine(compositeSkill, new MockProvider([]))).rejects.toThrow(AuthoringError);
  });

  it("refuses to persist tampered stages", async () => {
    const routine = await authorRoutine(routineSkill, new MockProvider([goodRoutine]));
    routine.stages[0].steps[0].teacher_says = "Reworded direction.";
    const root = await mkdtemp(join(tmpdir(), "pla-p3-"));
    await expect(writeRoutine(routine, root)).rejects.toThrow(/tampered/);
  });
});

describe("Example-sequence authoring", () => {
  const goodSeq = JSON.stringify({
    sequence_type: "negative_first",
    wording_template: "Is this line horizontal?",
    examples: [
      { example_id: "e1", kind: "negative", stimulus: "line tilted 2 degrees", expected_response: "No" },
      { example_id: "e2", kind: "positive", stimulus: "perfectly flat line", expected_response: "Yes" },
      { example_id: "e3", kind: "positive", stimulus: "flat line, longer", expected_response: "Yes" },
      { example_id: "e4", kind: "test", stimulus: "line tilted 45 degrees", expected_response: "No" },
    ],
    juxtaposition_blocks: [{ block_id: "b1", example_ids: ["e1", "e2", "e3"] }],
  });

  const horizontalSkill = SkillDefinition.parse({
    skill_id: "horizontal",
    name: "Horizontal",
    description: "Identify horizontal lines",
    concept_type: "single_dimension_non_comparative",
    mastery_criteria: { threshold: 0.85, required_consecutive: 5 },
  });

  it("authors a valid sequence", async () => {
    const seq = await authorExampleSequence(horizontalSkill, new MockProvider([goodSeq]));
    expect(seq.examples).toHaveLength(4);
  });

  it("retries when test examples repeat modeled stimuli", async () => {
    const badNovelty = JSON.stringify({
      ...JSON.parse(goodSeq),
      examples: JSON.parse(goodSeq).examples.map((e: any) =>
        e.example_id === "e4" ? { ...e, stimulus: "perfectly flat line" } : e
      ),
    });
    const seq = await authorExampleSequence(horizontalSkill, new MockProvider([badNovelty, goodSeq]));
    expect(seq.examples[3].stimulus).toBe("line tilted 45 degrees");
  });
});
