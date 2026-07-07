import { describe, expect, it } from "vitest";
import { ModeMachine, ModeContractError, stageContentHash } from "../src/core/modes.js";
import { RoutineStage } from "../src/schemas/instruction.js";

const stage: RoutineStage = RoutineStage.parse({
  skill_id: "fraction_multiplication",
  stage_id: "ORIGINAL",
  percent_overt: 100,
  steps: [
    {
      step_number: 1,
      teacher_says: "Read the problem.",
      learner_does: "Three-fifths times two-thirds.",
      correct_feedback: "Good.",
      error_feedback: "Listen: Three-fifths times two-thirds. Your turn.",
    },
    {
      step_number: 2,
      teacher_says: "What do you multiply first?",
      learner_does: "The top numbers.",
      correct_feedback: "Yes, the numerators.",
      error_feedback: "Top times top. What do you multiply first?",
    },
  ],
});

describe("Mode-contract state machine (D2)", () => {
  it("starts in ambient mode", () => {
    expect(new ModeMachine().current()).toBe("ambient");
  });

  it("accepted offer at the production moment transitions to focus mode", () => {
    const m = new ModeMachine();
    expect(m.offerFocus("wacc", true, "focus_di")).toBe(true);
    expect(m.current()).toBe("focus_di");
  });

  it("declined offers are NEVER repeated for the same node in the same session", () => {
    const m = new ModeMachine();
    expect(m.offerFocus("wacc", false, "focus_di")).toBe(false);
    // Second attempt: no offer is made at all, even if learner would accept.
    expect(m.offerFocus("wacc", true, "focus_di")).toBe(false);
    expect(m.current()).toBe("ambient");
    expect(m.session.offers).toHaveLength(1);
  });

  it("caps micro-diagnostics at 2 per natural pause", () => {
    const m = new ModeMachine();
    m.requestMicroDiagnostic();
    m.requestMicroDiagnostic();
    expect(() => m.requestMicroDiagnostic()).toThrow(ModeContractError);
    m.naturalPauseEnded();
    expect(() => m.requestMicroDiagnostic()).not.toThrow();
  });

  it("focus-DI delivery is verbatim replay — paraphrase is rejected", () => {
    const m = new ModeMachine();
    m.offerFocus("fraction_multiplication", true, "focus_di");
    m.enterFocusDI("fraction_multiplication", "ORIGINAL");
    expect(() => m.deliverStep(stage, "Read the problem.", 0)).not.toThrow();
    expect(() => m.deliverStep(stage, "Would you read the problem for me?", 0)).toThrow(
      /verbatim replay/
    );
  });

  it("learner exit mid-sequence = abort; restart at top of current juxtaposition block", () => {
    const m = new ModeMachine();
    m.offerFocus("fraction_multiplication", true, "focus_di");
    m.enterFocusDI("fraction_multiplication", "ORIGINAL");
    m.advanceWithinBlock();
    m.completeBlock(); // block 0 done
    m.advanceWithinBlock(); // partway through block 1
    const { restart_block } = m.abortSequence();
    expect(restart_block).toBe(1); // NOT position 1 of block 1 — top of block 1
    expect(m.current()).toBe("ambient");
  });

  it("checkpoints are legal only at covertization stage boundaries", () => {
    const m = new ModeMachine();
    m.offerFocus("fraction_multiplication", true, "focus_di");
    m.enterFocusDI("fraction_multiplication", "ORIGINAL");
    expect(() => m.checkpoint(false)).toThrow(/stage grain/);
    expect(() => m.checkpoint(true)).not.toThrow();
  });

  it("stage content hash is stable for frozen content, changes on any edit", () => {
    const h1 = stageContentHash(stage);
    const edited = {
      ...stage,
      steps: [{ ...stage.steps[0], teacher_says: "Read the problem!" }, stage.steps[1]],
    };
    expect(stageContentHash(edited)).not.toBe(h1);
    expect(stageContentHash(stage)).toBe(h1);
  });
});
