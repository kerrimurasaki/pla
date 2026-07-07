import { z } from "zod";
import { ExtractedSkill, GoalAnalysis, LearnerGoal } from "../schemas/goal.js";
import { LLMProvider } from "../llm/provider.js";
import { extractJson } from "../util/json.js";

const SYSTEM = `You extract the concrete skills a goal text actually demands.

Rules:
- Extract only skills the text itself evidences. For each skill, quote the exact span of the text (verbatim, character-for-character) that demands it.
- Skills are capabilities a learner could acquire and demonstrate through production ("build DCF valuation models"), not personality traits ("team player") or credentials ("bachelor's degree").
- Prefer 5-15 skills. Merge duplicates.

Respond with ONLY JSON:
{ "skills": [ { "name": "...", "description": "...", "evidence_quote": "<verbatim span from the text>" } ] }`;

export class GroundingError extends Error {}

const ExtractionResponse = z.object({ skills: z.array(ExtractedSkill).min(1) });

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Extract skills from a goal. Every extracted skill must quote a verbatim
 * span of the goal text — a skill the goal doesn't evidence is rejected
 * (grounded pipeline, Invariant 4 applied to goal analysis).
 */
export async function extractSkills(
  goal: LearnerGoal,
  provider: LLMProvider
): Promise<GoalAnalysis> {
  const raw = await provider.complete({
    system: SYSTEM,
    prompt: `Extract skills from this ${goal.kind.replace("_", " ")}:\n\n${goal.raw_text}`,
    json: true,
    temperature: 0,
  });
  const parsed = ExtractionResponse.parse(JSON.parse(extractJson(raw)));

  const haystack = normalize(goal.raw_text);
  const ungrounded = parsed.skills.filter((s) => !haystack.includes(normalize(s.evidence_quote)));
  if (ungrounded.length > 0) {
    throw new GroundingError(
      `Extracted skills not grounded in the goal text (evidence_quote is not a verbatim span): ` +
        ungrounded.map((s) => `"${s.name}"`).join(", ")
    );
  }

  return GoalAnalysis.parse({
    goal_id: goal.goal_id,
    extracted_skills: parsed.skills,
    analyzed_at: new Date().toISOString(),
  });
}
