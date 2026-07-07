import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { PracticeItem } from "../schemas/item.js";
import { PersonalSkillGraph } from "../schemas/goal.js";
import { EventLog } from "../core/eventLog.js";
import { LLMProvider } from "../llm/provider.js";
import { extractJson } from "../util/json.js";

export interface Assessment {
  correct: boolean;
  /** Index into item.common_errors when a known pattern matched. */
  matched_error: number | null;
  /** Specific feedback (what went wrong, why, what to do) — never vague. */
  feedback: string;
}

const JUDGE_SYSTEM = `You assess a learner's PRODUCED response against a known correct response.

Rules:
- "correct" means semantically equivalent to the correct response (phrasing/format may differ; meaning may not).
- If incorrect, check whether it matches one of the listed common error patterns; return that index, else null.
- If incorrect and unmatched, write feedback that states what specifically went wrong, why, and what to do differently. NEVER "try again" / "not quite" / "that's incorrect".

Respond with ONLY JSON: { "correct": bool, "matched_error": <index or null>, "feedback": "<only when incorrect and unmatched, else empty string>" }`;

const JudgeResponse = z.object({
  correct: z.boolean(),
  matched_error: z.number().int().nullable(),
  feedback: z.string(),
});

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * assess_response for well-structured items. Exact (normalized) match short-
 * circuits without an LLM call; otherwise the judge decides equivalence and
 * error-pattern match. Feedback for known patterns comes verbatim from the
 * item's authored common_errors (specific by construction).
 */
export async function assessResponse(
  item: PracticeItem,
  learnerResponse: string,
  provider: LLMProvider
): Promise<Assessment> {
  if (normalize(learnerResponse) === normalize(item.correct_response)) {
    return { correct: true, matched_error: null, feedback: "" };
  }

  const raw = await provider.complete({
    system: JUDGE_SYSTEM,
    prompt:
      `Item: ${item.stimulus}\nCorrect response: ${item.correct_response}\n` +
      `Skill requirement: ${item.skill_requirement}\n` +
      `Common error patterns:\n` +
      item.common_errors.map((e, i) => `${i}. ${e.error} — ${e.diagnosis}`).join("\n") +
      `\n\nLearner response: ${learnerResponse}`,
    json: true,
    temperature: 0,
  });
  const judged = JudgeResponse.parse(JSON.parse(extractJson(raw)));

  if (judged.correct) return { correct: true, matched_error: null, feedback: "" };
  if (judged.matched_error !== null && item.common_errors[judged.matched_error]) {
    return {
      correct: false,
      matched_error: judged.matched_error,
      feedback: item.common_errors[judged.matched_error].feedback,
    };
  }
  if (!judged.feedback.trim()) {
    throw new Error("Judge returned an incorrect verdict without specific feedback");
  }
  return { correct: false, matched_error: null, feedback: judged.feedback };
}

export interface DiagnosticFlowResult {
  assessment: Assessment;
  event_hash: string;
  gap_status: "unverified" | "in_progress" | "verified";
}

/**
 * The wired diagnostic flow (Phase 2): run item → assess → append mastery
 * event (Tier 2, normal assessment path — this is the one ambient signal
 * that legitimately updates mastery, D2) → update the graph's gap status.
 */
export async function runDiagnosticFlow(
  item: PracticeItem,
  learnerResponse: string,
  opts: {
    learner_id: string;
    goal_id: string;
    provider: LLMProvider;
    rootDir: string;
  }
): Promise<DiagnosticFlowResult> {
  const assessment = await assessResponse(item, learnerResponse, opts.provider);

  const log = new EventLog(opts.rootDir);
  const event = await log.append({
    event_id: `ev_${randomUUID().slice(0, 8)}`,
    learner_id: opts.learner_id,
    skill_id: item.skill_id,
    event_type: "micro_diagnostic",
    tier: 2,
    item_ref: item.item_id,
    response_ref: `resp_${randomUUID().slice(0, 8)}`,
    assessment_ref: JSON.stringify({ correct: assessment.correct, matched_error: assessment.matched_error }),
    correct: assessment.correct,
    timestamp: new Date().toISOString(),
  });

  // Any production evidence moves the node out of "unverified"; "verified"
  // is only ever set from a derived view meeting the gate — not here.
  const gap_status = await bumpGapStatus(opts.rootDir, opts.goal_id, item.skill_id);
  return { assessment, event_hash: event.event_hash, gap_status };
}

async function bumpGapStatus(
  rootDir: string,
  goalId: string,
  skillId: string
): Promise<"unverified" | "in_progress" | "verified"> {
  const path = join(rootDir, "Curriculum", goalId, "skill_graph.json");
  const graph = PersonalSkillGraph.parse(JSON.parse(await readFile(path, "utf8")));
  const entry = graph.gap_status.find((g) => g.skill_id === skillId);
  if (!entry) return "unverified";
  if (entry.status === "unverified") entry.status = "in_progress";
  await writeFile(path, JSON.stringify(graph, null, 2), "utf8");
  return entry.status;
}
