import { RoutineStage } from "../schemas/instruction.js";
import { ModeMachine, ModeContractError } from "../core/modes.js";
import { verifyFrozenStage } from "../authoring/routineAuthor.js";

export interface StepResult {
  correct: boolean;
  /** Verbatim feedback from the frozen step — never generated at runtime. */
  feedback: string;
  /** Correction protocol engaged: after producing the correct response, the
   * learner completes the problem again from the beginning (A-B pairing). */
  restart_required: boolean;
  stage_complete: boolean;
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Focus-DI delivery session (Phase 3). Enforces at runtime what authoring
 * froze: verbatim replay (hash-verified stage, wording checked per step by
 * ModeMachine), sequence atomicity (abort → block-top restart), correction
 * protocol on errors.
 *
 * For MVP each stage is delivered as one juxtaposition block; multi-block
 * stages arrive with example-sequence delivery.
 */
export class DISession {
  private stepIndex = 0;
  private erredThisRun = false;
  private awaitingCorrection = false;

  constructor(
    private stage: RoutineStage,
    private modes: ModeMachine
  ) {
    verifyFrozenStage(stage); // tampered/unfrozen content never reaches a learner
  }

  /** Begin delivery: requires an accepted focus offer (mode contract). */
  start(): string {
    this.modes.enterFocusDI(this.stage.skill_id, this.stage.stage_id);
    return this.deliver();
  }

  /** The current step's direction, verbatim from the frozen file. */
  private deliver(): string {
    const wording = this.stage.steps[this.stepIndex].teacher_says;
    this.modes.deliverStep(this.stage, wording, this.stepIndex); // verbatim guard
    return wording;
  }

  currentDirection(): string {
    return this.deliver();
  }

  /**
   * Submit the learner's overt response for the current step.
   * Error → verbatim error_feedback (model + your turn); the learner stays on
   * the step until they produce the correct response, then restarts the
   * problem from the beginning (correction protocol).
   */
  submit(learnerResponse: string): StepResult {
    const step = this.stage.steps[this.stepIndex];
    const correct = normalize(learnerResponse) === normalize(step.learner_does);

    if (!correct) {
      this.erredThisRun = true;
      this.awaitingCorrection = true;
      return {
        correct: false,
        feedback: step.error_feedback,
        restart_required: false,
        stage_complete: false,
      };
    }

    // Correct production after an error: complete the correction by
    // restarting the problem from the beginning.
    if (this.awaitingCorrection) {
      this.awaitingCorrection = false;
      this.stepIndex = 0;
      return {
        correct: true,
        feedback: step.correct_feedback,
        restart_required: true,
        stage_complete: false,
      };
    }

    this.modes.advanceWithinBlock();
    this.stepIndex++;

    if (this.stepIndex >= this.stage.steps.length) {
      this.modes.completeBlock();
      this.erredThisRun = false;
      this.stepIndex = 0;
      return {
        correct: true,
        feedback: step.correct_feedback,
        restart_required: false,
        stage_complete: true,
      };
    }

    return { correct: true, feedback: step.correct_feedback, restart_required: false, stage_complete: false };
  }

  /** Learner exit = abort, not pause. Restart point is the block top (D2). */
  abort(): { restart_block: number } {
    return this.modes.abortSequence();
  }

  /** Checkpoint is only legal here at the stage boundary. */
  checkpointAtStageEnd(): void {
    this.modes.checkpoint(true);
  }
}

export { ModeContractError };
