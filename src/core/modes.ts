import { createHash } from "node:crypto";
import { RoutineStage } from "../schemas/instruction.js";

export type Mode = "ambient" | "focus_di" | "focus_case";

export class ModeContractError extends Error {}

export interface FocusDIState {
  skill_id: string;
  stage_id: string;
  /** Index of the juxtaposition block currently in progress. */
  current_block: number;
  /** Position within the block. */
  position_in_block: number;
}

export interface SessionRecord {
  mode: Mode;
  offers: Array<{ skill_id: string; accepted: boolean; at: string }>;
  micro_diagnostics_this_pause: number;
}

/**
 * Mode-contract state machine (D2). Every rule is a checkable code path:
 *  - ambient is read-only on mastery (enforced with EventLog tier rules);
 *    here we enforce the offer discipline and micro-diagnostic cap
 *  - focus-DI delivery is verbatim replay (content-hash check)
 *  - DI sequences are atomic: exit = abort, restart at top of the current
 *    juxtaposition block; checkpoints only at stage boundaries
 */
export class ModeMachine {
  private mode: Mode = "ambient";
  private di: FocusDIState | null = null;
  private declinedOffers = new Set<string>(); // per session, per node
  readonly session: SessionRecord = { mode: "ambient", offers: [], micro_diagnostics_this_pause: 0 };

  current(): Mode {
    return this.mode;
  }

  // ---------- Ambient ----------

  /**
   * Offer focus work at the production moment. Returns false (no offer) if
   * this node was already declined this session — never repeat the offer.
   */
  offerFocus(skillId: string, learnerAccepts: boolean, target: "focus_di" | "focus_case"): boolean {
    if (this.mode !== "ambient") {
      throw new ModeContractError("Focus offers originate from ambient mode only");
    }
    if (this.declinedOffers.has(skillId)) return false;
    this.session.offers.push({ skill_id: skillId, accepted: learnerAccepts, at: new Date().toISOString() });
    if (!learnerAccepts) {
      this.declinedOffers.add(skillId);
      return false;
    }
    this.mode = target;
    this.session.mode = target;
    return true;
  }

  /** Micro-diagnostics: max 2 production items per natural pause (D2). */
  requestMicroDiagnostic(): void {
    if (this.mode !== "ambient") {
      throw new ModeContractError("Micro-diagnostics are an ambient-mode affordance");
    }
    if (this.session.micro_diagnostics_this_pause >= 2) {
      throw new ModeContractError("At most 2 micro-diagnostic items per natural pause");
    }
    this.session.micro_diagnostics_this_pause++;
  }

  naturalPauseEnded(): void {
    this.session.micro_diagnostics_this_pause = 0;
  }

  // ---------- Focus-DI ----------

  enterFocusDI(skillId: string, stageId: string): void {
    if (this.mode !== "focus_di") {
      throw new ModeContractError("Enter focus_di via an accepted offer (offerFocus)");
    }
    this.di = { skill_id: skillId, stage_id: stageId, current_block: 0, position_in_block: 0 };
  }

  /**
   * Verbatim-replay guard: delivered content must hash-match the frozen
   * stage file. Paraphrase drift is a changed stimulus — rejected.
   */
  deliverStep(stage: RoutineStage, deliveredTeacherWording: string, stepIndex: number): void {
    if (this.mode !== "focus_di" || !this.di) {
      throw new ModeContractError("deliverStep is only legal in focus_di mode");
    }
    const step = stage.steps[stepIndex];
    if (!step) throw new ModeContractError(`No step ${stepIndex} in stage ${stage.stage_id}`);
    if (deliveredTeacherWording !== step.teacher_says) {
      throw new ModeContractError(
        "Runtime instructional wording differs from validated routine content. " +
          "Focus-DI is verbatim replay only (D2)."
      );
    }
  }

  advanceWithinBlock(): void {
    if (!this.di) throw new ModeContractError("Not in a DI sequence");
    this.di.position_in_block++;
  }

  completeBlock(): void {
    if (!this.di) throw new ModeContractError("Not in a DI sequence");
    this.di.current_block++;
    this.di.position_in_block = 0;
  }

  /**
   * Learner exit mid-sequence = ABORT, not pause. The restart point is the
   * top of the current juxtaposition block.
   */
  abortSequence(): { restart_block: number } {
    if (this.mode !== "focus_di" || !this.di) {
      throw new ModeContractError("abortSequence only applies to focus_di");
    }
    const restart = this.di.current_block;
    this.di.position_in_block = 0;
    this.mode = "ambient";
    this.session.mode = "ambient";
    const state = { restart_block: restart };
    this.di = null;
    return state;
  }

  /** Checkpoints are legal ONLY at covertization stage boundaries. */
  checkpoint(atStageBoundary: boolean): void {
    if (this.mode === "focus_di" && !atStageBoundary) {
      throw new ModeContractError(
        "checkpoint() operates at stage grain only — never mid-sequence (D2)"
      );
    }
  }

  exitFocus(): void {
    if (this.mode === "ambient") return;
    this.mode = "ambient";
    this.session.mode = "ambient";
    this.di = null;
  }

  // ---------- Focus-case ----------

  enterFocusCase(): void {
    if (this.mode !== "focus_case") {
      throw new ModeContractError("Enter focus_case via an accepted offer (offerFocus)");
    }
  }
}

/** Freeze a routine stage: content hash used by the delivery-layer verbatim check. */
export function stageContentHash(stage: RoutineStage): string {
  const canonical = JSON.stringify(
    stage.steps.map((s) => [s.step_number, s.teacher_says, s.learner_does, s.correct_feedback, s.error_feedback])
  );
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
