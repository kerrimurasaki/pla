import { z } from "zod";
import { ExtractedSkill, GoalAnalysis, LearnerGoal } from "../schemas/goal.js";
import { LLMProvider } from "../llm/provider.js";
import { extractJson } from "../util/json.js";

const SYSTEM = `You extract the concrete skills a goal text actually demands.

Rules:
- Extract TEACHABLE CAPABILITIES, not job phases, responsibility areas, or section headings. "Maintenance" is a phase; "diagnosing and fixing reported software defects" is a capability. "Requirements" is a heading; "eliciting requirements from stakeholders through interviews" is a capability. Name each skill as a verb-first capability phrase describing what the learner will be able to DO.
- Skills are capabilities a learner could acquire and demonstrate through production, not personality traits ("team player") or credentials ("bachelor's degree").
- For each skill, quote the exact span of the text (verbatim, character-for-character) that demands it. The quote must be a meaningful phrase — never a single word.
- Prefer 5-15 skills. Merge duplicates and near-synonyms into one skill.

Respond with ONLY JSON:
{ "skills": [ { "name": "...", "description": "...", "evidence_quote": "<verbatim phrase from the text>" } ] }`;

export class GroundingError extends Error {}

const ExtractionResponse = z.object({ skills: z.array(ExtractedSkill).min(1) });

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Extract skills from a goal. Every extracted skill must quote a verbatim
 * span of the goal text — a skill the goal doesn't evidence is rejected
 * (grounded pipeline, Invariant 4 applied to goal analysis).
 *
 * F3 (first e2e run): single-word evidence quotes ("requirements",
 * "maintenance") signalled heading-extraction rather than capability
 * extraction — now rejected deterministically, and rejections are fed back
 * for a retry like the rest of the generate→validate loops.
 */
export async function extractSkills(
  goal: LearnerGoal,
  provider: LLMProvider,
  maxAttempts = 2
): Promise<GoalAnalysis> {
  const haystack = normalize(goal.raw_text);
  let lastErrors: string[] = [];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const raw = await provider.complete({
      system: SYSTEM,
      prompt:
        `Extract skills from this ${goal.kind.replace("_", " ")}:\n\n${goal.raw_text}` +
        (lastErrors.length
          ? `\n\nYour previous extraction was rejected:\n${lastErrors.join("\n")}\nFix these and re-extract.`
          : ""),
      json: true,
      temperature: 0,
    });

    let skills: ExtractedSkill[];
    try {
      skills = ExtractionResponse.parse(JSON.parse(extractJson(raw))).skills;
    } catch (err) {
      lastErrors = [err instanceof Error ? err.message : String(err)];
      continue;
    }

    const errors: string[] = [];
    for (const s of skills) {
      if (!haystack.includes(normalize(s.evidence_quote))) {
        errors.push(`"${s.name}": evidence_quote is not a verbatim span of the goal text`);
      }
      if (normalize(s.evidence_quote).split(" ").length < 2) {
        errors.push(
          `"${s.name}": evidence_quote "${s.evidence_quote}" is a single word — quote the meaningful phrase that demands this capability`
        );
      }
    }
    if (errors.length === 0) {
      return GoalAnalysis.parse({
        goal_id: goal.goal_id,
        extracted_skills: skills,
        analyzed_at: new Date().toISOString(),
      });
    }
    lastErrors = errors;
  }

  throw new GroundingError(
    `Extracted skills not grounded in the goal text after ${maxAttempts} attempts: ${lastErrors.join("; ")}`
  );
}
