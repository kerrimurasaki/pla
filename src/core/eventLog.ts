import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  GENESIS_HASH,
  MasteryEvent,
  MasteryEventInput,
} from "../schemas/events.js";
import { MasteryView } from "../schemas/claim.js";
import { MasteryCriteria, SkillDefinition } from "../schemas/skill.js";
import { computeEventHash, verifyChain } from "./hashchain.js";

/** Rolling window for the derived production-accuracy level. */
const LEVEL_WINDOW = 20;

export class TierViolationError extends Error {}
export class AppendOnlyViolationError extends Error {}

/**
 * Append-only, hash-chained mastery event log (D7).
 * One JSONL file per learner×skill: Learners/{learner}/events/{skill}.log.jsonl
 *
 * HARD RULES enforced here, not by caller discipline:
 *  - Tier 3 events never enter the mastery log (Invariant 3 / D7).
 *  - Events are appended, never rewritten; the chain makes edits evident.
 */
export class EventLog {
  constructor(private rootDir: string) {}

  private logPath(learnerId: string, skillId: string): string {
    return join(this.rootDir, "Learners", learnerId, "events", `${skillId}.log.jsonl`);
  }

  async read(learnerId: string, skillId: string): Promise<MasteryEvent[]> {
    try {
      const raw = await readFile(this.logPath(learnerId, skillId), "utf8");
      return raw
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .map((l) => MasteryEvent.parse(JSON.parse(l)));
    } catch (err: any) {
      if (err?.code === "ENOENT") return [];
      throw err;
    }
  }

  /**
   * Append a mastery event. Computes the chain fields itself so callers
   * cannot forge or fork history.
   */
  async append(input: MasteryEventInput): Promise<MasteryEvent> {
    const parsed = MasteryEventInput.parse(input);

    if (parsed.tier === 3) {
      throw new TierViolationError(
        "Tier 3 (ambient/unsupervised) signal never touches mastery state. " +
          "Write it to the candidate-gaps queue instead."
      );
    }

    const existing = await this.read(parsed.learner_id, parsed.skill_id);
    const prior = existing.length === 0 ? GENESIS_HASH : existing[existing.length - 1].event_hash;
    const event: MasteryEvent = {
      ...parsed,
      prior_event_hash: prior,
      event_hash: computeEventHash({
        item_ref: parsed.item_ref,
        response_ref: parsed.response_ref,
        assessment_ref: parsed.assessment_ref,
        timestamp: parsed.timestamp,
        prior_event_hash: prior,
      }),
    };

    const path = this.logPath(parsed.learner_id, parsed.skill_id);
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, JSON.stringify(event) + "\n", "utf8");
    return event;
  }

  async verify(learnerId: string, skillId: string) {
    return verifyChain(await this.read(learnerId, skillId));
  }
}

/**
 * Derive mastery.json from the event log (pure function of the log — if the
 * view and the log ever disagree, the log wins).
 */
export function deriveMasteryView(
  events: MasteryEvent[],
  skill: SkillDefinition
): MasteryView {
  const criteria: MasteryCriteria = skill.mastery_criteria;
  const production = events; // the log only ever contains production events

  // Consecutive correct from the tail.
  let consecutive = 0;
  for (let i = production.length - 1; i >= 0; i--) {
    const e = production[i];
    const ok = e.correct === true || e.passed === true;
    if (ok) consecutive++;
    else break;
  }

  const window = production.slice(-LEVEL_WINDOW);
  const scored = window.filter((e) => e.correct !== undefined || e.passed !== undefined);
  const level =
    scored.length === 0
      ? 0
      : scored.filter((e) => e.correct === true || e.passed === true).length / scored.length;

  let eligible =
    level >= criteria.threshold && consecutive >= criteria.required_consecutive;

  let dimensional_coverage: MasteryView["dimensional_coverage"];
  if (skill.concept_type === "ill_structured_composite") {
    const cc = criteria.criss_crossing ?? {
      min_disciplinary_dimensions: 3,
      min_same_case_revisits_different_lens: 1,
      oral_defense_required: true,
    };
    const caseEvents = production.filter((e) => e.event_type === "case_task");
    const dims = [
      ...new Set(caseEvents.map((e) => e.disciplinary_dimension).filter((d): d is string => !!d)),
    ];
    // Same case revisited under a different dimensional lens than first traversal.
    const byCase = new Map<string, Set<string>>();
    for (const e of caseEvents) {
      if (!e.case_id || !e.disciplinary_dimension) continue;
      if (!byCase.has(e.case_id)) byCase.set(e.case_id, new Set());
      byCase.get(e.case_id)!.add(e.disciplinary_dimension);
    }
    const revisit = [...byCase.values()].some((lenses) => lenses.size >= 2);
    const defensePassed = production.some(
      (e) => e.event_type === "oral_defense" && e.passed === true && e.tier === 1
    );
    dimensional_coverage = {
      dimensions_produced: dims,
      same_case_revisit_different_lens: revisit,
      oral_defense_passed: defensePassed,
    };
    eligible =
      dims.length >= cc.min_disciplinary_dimensions &&
      (cc.min_same_case_revisits_different_lens === 0 || revisit) &&
      (!cc.oral_defense_required || defensePassed);
  }

  return MasteryView.parse({
    learner_id: events[0]?.learner_id ?? "",
    skill_id: skill.skill_id,
    mastery_state: {
      current_level: level,
      threshold: criteria.threshold,
      consecutive_correct: consecutive,
      required_consecutive: criteria.required_consecutive,
      credential_eligible: eligible,
    },
    dimensional_coverage,
    event_count: events.length,
    last_event_hash: events.length ? events[events.length - 1].event_hash : GENESIS_HASH,
  });
}
