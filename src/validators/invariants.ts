import { PracticeItem } from "../schemas/item.js";
import { CaseSource, CaseTask } from "../schemas/case.js";
import { ExampleSequence, Routine } from "../schemas/instruction.js";
import { SkillDefinition } from "../schemas/skill.js";
import { MasteryEvent } from "../schemas/events.js";
import { MasteryView } from "../schemas/claim.js";
import { verifyChain } from "../core/hashchain.js";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const ok = (): ValidationResult => ({ valid: true, errors: [] });
const fail = (errors: string[]): ValidationResult => ({ valid: false, errors });

const VAGUE_FEEDBACK = /^(try again|that'?s incorrect|not quite)\.?$/i;

/**
 * Invariant 1 + Invariant 3 checks for a standard practice item:
 * skill-only path (shortcut check all-false), production-based, novel,
 * specific feedback prepared.
 */
export function validatePracticeItem(raw: unknown): ValidationResult {
  const parsed = PracticeItem.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  const item = parsed.data;
  const errors: string[] = [];

  const sc = item.shortcut_check;
  if (sc.pattern_matching_possible) errors.push("Invariant 1: pattern matching can bypass the skill");
  if (sc.process_of_elimination_possible) errors.push("Invariant 1: process of elimination can bypass the skill");
  if (sc.memorization_possible) errors.push("Invariant 1: memorization can bypass the skill");
  if (!item.novel) errors.push("Test items must be novel — never shown during instruction");
  for (const ce of item.common_errors) {
    if (VAGUE_FEEDBACK.test(ce.feedback.trim())) {
      errors.push(`Vague feedback forbidden: "${ce.feedback}" — say what went wrong, why, and what to do`);
    }
  }
  return errors.length ? fail(errors) : ok();
}

/**
 * Invariant 1 (modified form for cases) + Invariant 4: rubric indicators
 * case-fact-anchored, generic fluency insufficient, provenance present.
 */
export function validateCaseTask(rawTask: unknown, rawSource: unknown): ValidationResult {
  const errors: string[] = [];
  const task = CaseTask.safeParse(rawTask);
  if (!task.success) return fail(task.error.issues.map((i) => `task.${i.path.join(".")}: ${i.message}`));
  const source = CaseSource.safeParse(rawSource);
  if (!source.success) {
    errors.push(
      ...source.error.issues.map((i) => `source.${i.path.join(".")}: ${i.message} (Invariant 4: grounded content only)`)
    );
  }
  if (task.data.shortcut_check.generic_fluency_sufficient) {
    errors.push("Rubric can be satisfied by generic verbal fluency — redesign indicators (Invariant 1)");
  }
  for (const ind of task.data.rubric) {
    const anchors = Array.isArray(ind.anchored_to) ? ind.anchored_to : [ind.anchored_to];
    if (anchors.length === 0 || anchors.some((a) => a.trim() === "")) {
      errors.push(`Rubric indicator not anchored to case facts: "${ind.indicator}"`);
    }
  }
  if (source.success && task.data.case_id !== source.data.case_id) {
    errors.push("Task/source case_id mismatch");
  }
  return errors.length ? fail(errors) : ok();
}

/**
 * Routing rule (D4, HARD): ill_structured_composite never gets a routine or
 * example sequence. Generating one is checklist theater.
 */
export function validateRoutineRouting(skill: SkillDefinition): ValidationResult {
  if (skill.concept_type === "ill_structured_composite") {
    return fail([
      `${skill.skill_id} is ill_structured_composite: route to the CASE ENGINE. ` +
        "Never overtize/covertize judgment (checklist theater).",
    ]);
  }
  return ok();
}

/** Covertization: support fades ≤30 percentage points per stage, non-increasing. */
export function validateRoutine(raw: unknown, skill: SkillDefinition): ValidationResult {
  const routing = validateRoutineRouting(skill);
  if (!routing.valid) return routing;
  const parsed = Routine.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  const errors: string[] = [];
  const stages = parsed.data.stages;
  for (let i = 1; i < stages.length; i++) {
    const drop = stages[i - 1].percent_overt - stages[i].percent_overt;
    if (drop < 0) errors.push(`Stage ${stages[i].stage_id}: percent_overt increases — stages must fade`);
    if (drop > 30) {
      errors.push(
        `Stage ${stages[i].stage_id}: fade of ${drop}% exceeds the ≤30%-per-stage limit (D8 validated constant)`
      );
    }
  }
  return errors.length ? fail(errors) : ok();
}

/**
 * Example-sequence rules: juxtaposition blocks marked and covering, wording
 * consistent, test examples novel (disjoint from modeled examples).
 */
export function validateExampleSequence(raw: unknown, skill: SkillDefinition): ValidationResult {
  const routing = validateRoutineRouting(skill);
  if (!routing.valid) return routing;
  const parsed = ExampleSequence.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  const seq = parsed.data;
  const errors: string[] = [];

  const ids = new Set(seq.examples.map((e) => e.example_id));
  const blockIds = new Set<string>();
  for (const b of seq.juxtaposition_blocks) {
    for (const id of b.example_ids) {
      if (!ids.has(id)) errors.push(`Block ${b.block_id} references unknown example '${id}'`);
      blockIds.add(id);
    }
  }
  for (const e of seq.examples) {
    if (e.kind !== "test" && !blockIds.has(e.example_id)) {
      errors.push(`Example '${e.example_id}' is not in any juxtaposition block — restart points undefined`);
    }
  }

  const modeled = new Set(
    seq.examples.filter((e) => e.kind !== "test").map((e) => e.stimulus.trim().toLowerCase())
  );
  for (const t of seq.examples.filter((e) => e.kind === "test")) {
    if (modeled.has(t.stimulus.trim().toLowerCase())) {
      errors.push(`Test example '${t.example_id}' repeats a modeled stimulus — test examples must be novel`);
    }
  }
  if (!seq.examples.some((e) => e.kind === "test")) {
    errors.push("Sequence has no test examples");
  }
  return errors.length ? fail(errors) : ok();
}

export interface ClaimCheckInput {
  constituent_views: MasteryView[]; // one per constituent skill, derived from logs
  constituent_skills: SkillDefinition[];
  /** Full event lists per constituent (for chain + integrative checks). */
  events_by_skill: Record<string, MasteryEvent[]>;
}

/**
 * Credential gate (Invariant 2 / D7) — the ONE place hard gating lives.
 * Returns precisely which evidence is missing; never blocks the learner,
 * only the claim.
 */
export function checkClaimEligibility(input: ClaimCheckInput): ValidationResult {
  const errors: string[] = [];
  const viewsById = new Map(input.constituent_views.map((v) => [v.skill_id, v]));

  for (const skill of input.constituent_skills) {
    const view = viewsById.get(skill.skill_id);
    if (!view) {
      errors.push(`${skill.skill_id}: no mastery evidence at all`);
      continue;
    }
    if (!view.mastery_state.credential_eligible) {
      if (skill.concept_type === "ill_structured_composite") {
        const dc = view.dimensional_coverage;
        errors.push(
          `${skill.skill_id}: criss-crossing gate unmet — dimensions produced: ` +
            `${dc?.dimensions_produced.length ?? 0}, revisit under different lens: ` +
            `${dc?.same_case_revisit_different_lens ?? false}, oral defense passed: ${dc?.oral_defense_passed ?? false}`
        );
      } else {
        errors.push(
          `${skill.skill_id}: production gate unmet — level ${view.mastery_state.current_level.toFixed(2)}/` +
            `${view.mastery_state.threshold}, consecutive ${view.mastery_state.consecutive_correct}/` +
            `${view.mastery_state.required_consecutive}`
        );
      }
    }
  }

  const allEvents = Object.values(input.events_by_skill).flat();

  // Tier rules: zero Tier 3 in evidence (structurally impossible via EventLog,
  // but re-checked here because claims may bundle imported evidence).
  if (allEvents.some((e) => e.tier === 3)) {
    errors.push("Evidence bundle contains Tier 3 events — Tier 3 never evidences a claim");
  }
  if (!allEvents.some((e) => e.tier === 1)) {
    errors.push("No Tier 1 event — no claim without at least one defended, synchronous production event");
  }

  // ≥1 integrative Tier 1 case task spanning multiple constituents.
  const constituentIds = new Set(input.constituent_skills.map((s) => s.skill_id));
  const integrative = allEvents.some(
    (e) =>
      e.tier === 1 &&
      e.event_type === "case_task" &&
      (e.spanned_skill_ids?.filter((id) => constituentIds.has(id)).length ?? 0) >= 2
  );
  if (!integrative) {
    errors.push("No integrative Tier 1 case task spanning ≥2 constituent skills");
  }

  // Hash chains must verify.
  for (const [skillId, events] of Object.entries(input.events_by_skill)) {
    const v = verifyChain(events);
    if (!v.valid) errors.push(`${skillId}: event chain fails verification at index ${v.broken_at} (${v.reason})`);
  }

  return errors.length ? fail(errors) : ok();
}
