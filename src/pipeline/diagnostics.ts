import { randomUUID } from "node:crypto";
import { PracticeItem } from "../schemas/item.js";
import { SkillDefinition } from "../schemas/skill.js";
import { validatePracticeItem } from "../validators/invariants.js";
import { LLMProvider } from "../llm/provider.js";
import { extractJson } from "../util/json.js";

const SYSTEM = `You generate ONE production-based diagnostic item for a skill.

Hard requirements (the item is machine-rejected otherwise):
- PRODUCTION: the learner must generate the answer, never select from options.
- SKILL-ONLY PATH: the item cannot be answered by pattern matching, elimination, or memorization — set each shortcut_check field honestly; if any would be true, redesign until all are false.
- NOVEL: not a textbook classic the learner may have memorized.
- SPECIFIC FEEDBACK: at least one common error with diagnosis and feedback that says what went wrong, why, and what to do differently (never "try again").

Respond with ONLY JSON matching:
{
  "stimulus": "...",
  "correct_response": "...",
  "skill_requirement": "...",
  "shortcut_check": { "pattern_matching_possible": false, "process_of_elimination_possible": false, "memorization_possible": false },
  "common_errors": [ { "error": "...", "diagnosis": "...", "feedback": "..." } ]
}`;

export class DiagnosticGenerationError extends Error {}

/**
 * Generate a micro-diagnostic production item for a skill (Phase 2 flow).
 * Generated → validated against invariants → returned only if it passes
 * (anti-pattern: generate → present without checks). One retry on failure.
 *
 * Note: diagnostics run through the normal assessment path (Tier 2 when
 * unaided-but-observed; the ambient micro-diagnostic cap lives in ModeMachine).
 */
export async function generateDiagnostic(
  skill: SkillDefinition,
  provider: LLMProvider,
  maxAttempts = 2
): Promise<PracticeItem> {
  if (skill.concept_type === "ill_structured_composite") {
    throw new DiagnosticGenerationError(
      `${skill.skill_id} is ill_structured_composite — diagnose its COMPONENTS with items; ` +
        "the composite itself is only assessed through cases (D4)."
    );
  }

  let lastErrors: string[] = [];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const raw = await provider.complete({
      system: SYSTEM,
      prompt:
        `Skill: ${skill.name} (${skill.concept_type})\nDescription: ${skill.description}` +
        (lastErrors.length
          ? `\n\nYour previous item was rejected:\n${lastErrors.join("\n")}\nFix these and regenerate.`
          : ""),
      json: true,
      temperature: 0,
    });
    const candidate = {
      ...JSON.parse(extractJson(raw)),
      item_id: `diag_${randomUUID().slice(0, 8)}`,
      skill_id: skill.skill_id,
      novel: true,
    };
    const v = validatePracticeItem(candidate);
    if (v.valid) return PracticeItem.parse(candidate);
    lastErrors = v.errors;
  }
  throw new DiagnosticGenerationError(
    `Could not generate an invariant-compliant diagnostic for ${skill.skill_id}: ${lastErrors.join("; ")}`
  );
}
