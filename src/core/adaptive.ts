import { MasteryEvent } from "../schemas/events.js";
import { MasteryView } from "../schemas/claim.js";
import { SkillDefinition } from "../schemas/skill.js";

/**
 * Advisory adaptive logic (Invariant 2 / D5). Note the type system itself:
 * there is no "block" advisory — the machine cannot express refusal to let
 * the learner continue.
 */
export type Advisory =
  | { type: "fade_support"; skill_id: string; message: string }
  | { type: "restore_support"; skill_id: string; message: string }
  | { type: "prereq_nudge"; skill_id: string; prerequisite_id: string; message: string }
  | { type: "cost_visibility"; skill_id: string; message: string };

export interface AdaptiveConfig {
  /** Fade scaffold after this many consecutive correct at current support. */
  decrease_support_after: number;
  /** Restore scaffold after this many consecutive failures. */
  increase_support_after: number;
}

export const DEFAULT_ADAPTIVE: AdaptiveConfig = {
  decrease_support_after: 3,
  increase_support_after: 2,
};

/**
 * Per-session advisory guard: each nudge fires at most once per session per
 * node, then the learner's choice is respected (D5).
 */
export class AdvisorySession {
  private fired = new Set<string>();

  private once(key: string): boolean {
    if (this.fired.has(key)) return false;
    this.fired.add(key);
    return true;
  }

  /**
   * Compute advisories from the derived view and recent events. Pure
   * diagnosis + cost/benefit surfacing; the learner always decides.
   */
  advise(
    skill: SkillDefinition,
    view: MasteryView,
    recentEvents: MasteryEvent[],
    opts: {
      /** Prerequisite the current error pattern traces to, if diagnosed. */
      traced_prerequisite?: string;
      /** Learner is attempting work above their verified level. */
      working_above_verified_level?: boolean;
      config?: AdaptiveConfig;
    } = {}
  ): Advisory[] {
    const cfg = opts.config ?? DEFAULT_ADAPTIVE;
    const advisories: Advisory[] = [];

    let tailFailures = 0;
    for (let i = recentEvents.length - 1; i >= 0; i--) {
      const ok = recentEvents[i].correct === true || recentEvents[i].passed === true;
      if (ok) break;
      tailFailures++;
    }

    if (view.mastery_state.consecutive_correct >= cfg.decrease_support_after) {
      advisories.push({
        type: "fade_support",
        skill_id: skill.skill_id,
        message: `${view.mastery_state.consecutive_correct} consecutive correct — ready to fade to the next covertization stage.`,
      });
    }

    if (tailFailures >= cfg.increase_support_after) {
      advisories.push({
        type: "restore_support",
        skill_id: skill.skill_id,
        message: `${tailFailures} consecutive errors — restoring the previous scaffold level would help; your call.`,
      });
    }

    if (opts.traced_prerequisite && this.once(`prereq:${skill.skill_id}:${opts.traced_prerequisite}`)) {
      advisories.push({
        type: "prereq_nudge",
        skill_id: skill.skill_id,
        prerequisite_id: opts.traced_prerequisite,
        message:
          `Your recent errors on ${skill.name} trace to '${opts.traced_prerequisite}'. ` +
          `~15 minutes there would probably unstick this. Want to detour? You can also just continue.`,
      });
    }

    if (opts.working_above_verified_level && this.once(`cost:${skill.skill_id}`)) {
      const pct = Math.round((1 - view.mastery_state.current_level) * 100);
      advisories.push({
        type: "cost_visibility",
        skill_id: skill.skill_id,
        message:
          `You can continue — expect friction: current error rate ~${pct}% on ${skill.name}, ` +
          `traceable to unverified components. A short focused block would verify them. Your call.`,
      });
    }

    return advisories;
  }
}
