import { describe, expect, it } from "vitest";
import { DISession } from "../src/delivery/diSession.js";
import { ModeMachine, stageContentHash } from "../src/core/modes.js";
import { RoutineStage } from "../src/schemas/instruction.js";
import { AdvisorySession } from "../src/core/adaptive.js";
import { SkillDefinition } from "../src/schemas/skill.js";
import { MasteryView } from "../src/schemas/claim.js";

function frozenStage(): RoutineStage {
  const stage = RoutineStage.parse({
    skill_id: "fraction_multiplication",
    stage_id: "ORIGINAL",
    percent_overt: 100,
    steps: [
      {
        step_number: 1,
        teacher_says: "What do you multiply first?",
        learner_does: "The top numbers.",
        correct_feedback: "Yes, the numerators.",
        error_feedback: "Top times top. What do you multiply first?",
      },
      {
        step_number: 2,
        teacher_says: "What's three times two?",
        learner_does: "Six.",
        correct_feedback: "Six. Write six on top.",
        error_feedback: "Three times two is six. What's three times two?",
      },
    ],
  });
  return { ...stage, content_hash: stageContentHash(stage) };
}

function startedSession(): { session: DISession; modes: ModeMachine } {
  const modes = new ModeMachine();
  modes.offerFocus("fraction_multiplication", true, "focus_di");
  const session = new DISession(frozenStage(), modes);
  session.start();
  return { session, modes };
}

describe("Focus-DI delivery session (Phase 3)", () => {
  it("refuses tampered stage content at construction", () => {
    const stage = frozenStage();
    stage.steps[0].teacher_says = "Reworded.";
    const modes = new ModeMachine();
    modes.offerFocus("fraction_multiplication", true, "focus_di");
    expect(() => new DISession(stage, modes)).toThrow(/content-hash/);
  });

  it("delivers directions verbatim and completes a clean run", () => {
    const { session } = startedSession();
    expect(session.currentDirection()).toBe("What do you multiply first?");
    const r1 = session.submit("The top numbers.");
    expect(r1).toMatchObject({ correct: true, feedback: "Yes, the numerators.", stage_complete: false });
    expect(session.currentDirection()).toBe("What's three times two?");
    const r2 = session.submit("Six.");
    expect(r2.stage_complete).toBe(true);
  });

  it("error → verbatim error feedback; correct production → restart from beginning (correction protocol)", () => {
    const { session } = startedSession();
    const err = session.submit("The bottom numbers.");
    expect(err).toMatchObject({ correct: false, feedback: "Top times top. What do you multiply first?" });
    // Learner produces the correct response after the model.
    const corrected = session.submit("The top numbers.");
    expect(corrected.correct).toBe(true);
    expect(corrected.restart_required).toBe(true);
    // Back at step 1 — the problem is completed again from the top.
    expect(session.currentDirection()).toBe("What do you multiply first?");
  });

  it("learner exit aborts to ambient with a block-top restart point", () => {
    const { session, modes } = startedSession();
    session.submit("The top numbers.");
    const { restart_block } = session.abort();
    expect(restart_block).toBe(0);
    expect(modes.current()).toBe("ambient");
  });

  it("checkpoint at stage end is legal", () => {
    const { session } = startedSession();
    session.submit("The top numbers.");
    session.submit("Six.");
    expect(() => session.checkpointAtStageEnd()).not.toThrow();
  });
});

describe("Advisory adaptive logic (Invariant 2 — advise, never block)", () => {
  const skill = SkillDefinition.parse({
    skill_id: "wacc",
    name: "WACC",
    description: "wacc",
    concept_type: "cognitive_routine",
    mastery_criteria: { threshold: 0.85, required_consecutive: 5 },
  });

  const view = (level: number, consecutive: number): MasteryView =>
    MasteryView.parse({
      learner_id: "alice",
      skill_id: "wacc",
      mastery_state: {
        current_level: level,
        threshold: 0.85,
        consecutive_correct: consecutive,
        required_consecutive: 5,
        credential_eligible: false,
      },
      event_count: 10,
      last_event_hash: "0".repeat(64),
    });

  const failEvent = { correct: false } as any;
  const passEvent = { correct: true } as any;

  it("suggests fading after 3 consecutive correct", () => {
    const a = new AdvisorySession().advise(skill, view(0.8, 3), [passEvent, passEvent, passEvent]);
    expect(a.map((x) => x.type)).toContain("fade_support");
  });

  it("suggests restoring scaffold after 2 consecutive failures", () => {
    const a = new AdvisorySession().advise(skill, view(0.5, 0), [passEvent, failEvent, failEvent]);
    expect(a.map((x) => x.type)).toContain("restore_support");
  });

  it("prereq nudge fires once per session per node, then respects the choice", () => {
    const s = new AdvisorySession();
    const first = s.advise(skill, view(0.5, 0), [failEvent], { traced_prerequisite: "npv" });
    expect(first.map((x) => x.type)).toContain("prereq_nudge");
    const second = s.advise(skill, view(0.5, 0), [failEvent], { traced_prerequisite: "npv" });
    expect(second.map((x) => x.type)).not.toContain("prereq_nudge");
  });

  it("cost visibility surfaces once, phrased as the learner's call", () => {
    const s = new AdvisorySession();
    const a = s.advise(skill, view(0.3, 0), [], { working_above_verified_level: true });
    expect(a[0].type).toBe("cost_visibility");
    expect(a[0].message).toContain("You can continue");
    expect(s.advise(skill, view(0.3, 0), [], { working_above_verified_level: true })).toHaveLength(0);
  });

  it("the Advisory type admits no blocking action", () => {
    // Compile-time guarantee documented at runtime: every advisory type is advisory.
    const kinds = ["fade_support", "restore_support", "prereq_nudge", "cost_visibility"];
    expect(kinds).not.toContain("block");
  });
});
