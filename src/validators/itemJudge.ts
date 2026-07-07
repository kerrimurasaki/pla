import { z } from "zod";
import { PracticeItem } from "../schemas/item.js";
import { LLMProvider } from "../llm/provider.js";
import { extractJson } from "../util/json.js";

/**
 * Adversarial item validation (F1, 2026-07-07). The generating model's
 * shortcut_check is self-reported — it asserts all-false because the prompt
 * demands it. This judge is a SEPARATE call whose job is to break the item,
 * not to pass it. First real end-to-end run produced "describe the steps of
 * coding"-style items for a coding skill: describable from a textbook,
 * no performance required. That is the failure mode this exists to catch.
 */
const JUDGE_SYSTEM = `You are an adversarial reviewer of practice items for a mastery-based learning system. Your job is to REJECT items that don't genuinely test the skill. You are the check, not the author — be skeptical.

Evaluate three things:

1. DOING vs DESCRIBING: Does answering require actually PERFORMING the skill on a concrete instance, or can it be satisfied by describing/explaining how the skill works in general? "Describe the steps you would take to X" tests describing X, not doing X. A coding item must require writing code; a stakeholder-analysis item must require analyzing given stakeholders; an item about a procedure must require executing the procedure on specific inputs.
2. SKILL-ONLY PATH: Could a learner WITHOUT the skill produce an acceptable answer via textbook recall, generic professional common sense, or eloquent generalities?
3. CONCRETENESS: Is the correct_response an actual complete answer to this specific stimulus (not a template, not placeholder text, not a meta-description of what an answer would contain)?

Respond with ONLY JSON:
{
  "requires_doing_not_describing": bool,
  "solvable_without_skill": bool,
  "response_is_concrete": bool,
  "reasons": ["<one short sentence per failed check, naming what to change>"]
}`;

const JudgeResponse = z.object({
  requires_doing_not_describing: z.boolean(),
  solvable_without_skill: z.boolean(),
  response_is_concrete: z.boolean(),
  reasons: z.array(z.string()),
});

export interface ItemJudgement {
  passes: boolean;
  reasons: string[];
}

export async function judgePracticeItem(
  item: PracticeItem,
  provider: LLMProvider
): Promise<ItemJudgement> {
  const raw = await provider.complete({
    system: JUDGE_SYSTEM,
    prompt:
      `Skill being tested: ${item.skill_id}\n` +
      `Skill requirement claimed: ${item.skill_requirement}\n\n` +
      `Stimulus: ${item.stimulus}\n\n` +
      `Correct response: ${item.correct_response}`,
    json: true,
    temperature: 0,
  });

  let judged: z.infer<typeof JudgeResponse>;
  try {
    judged = JudgeResponse.parse(JSON.parse(extractJson(raw)));
  } catch {
    // Unparseable judge output counts as a rejection (never wave an item
    // through because the check itself glitched); the reason feeds the
    // generator's retry.
    return { passes: false, reasons: ["adversarial judge output was unparseable — regenerate the item"] };
  }

  const passes =
    judged.requires_doing_not_describing && !judged.solvable_without_skill && judged.response_is_concrete;
  return {
    passes,
    reasons: passes
      ? []
      : judged.reasons.length
        ? judged.reasons
        : ["adversarial judge rejected the item without detailed reasons"],
  };
}
