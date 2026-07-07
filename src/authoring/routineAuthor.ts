import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Routine, RoutineStage } from "../schemas/instruction.js";
import { SkillDefinition } from "../schemas/skill.js";
import { validateRoutine } from "../validators/invariants.js";
import { stageContentHash } from "../core/modes.js";
import { LLMProvider } from "../llm/provider.js";
import { extractJson } from "../util/json.js";

const SYSTEM = `You author a Direct Instruction cognitive routine with covertization stages.

Hard requirements (machine-rejected otherwise):
- Fully overtized first stage: every cognitive step explicit — teacher_says (direction), learner_does (observable response), correct_feedback (confirmation), error_feedback (model the correct response, then require the learner's turn).
- Covertization: stages fade support by AT MOST 30 percentage points each (canonical schedule: 100 → 75 → 50 → 25 → 0). percent_overt never increases.
- Wording is consistent across stages: covertized stages use abbreviated instructions that mean the same as the detailed version (equivalent pairs), never reworded stimuli.
- Every step observable, testable, functional.

Respond with ONLY JSON:
{
  "stages": [
    {
      "stage_id": "ORIGINAL",
      "percent_overt": 100,
      "steps": [
        { "step_number": 1, "teacher_says": "...", "learner_does": "...", "correct_feedback": "...", "error_feedback": "..." }
      ]
    }
  ]
}`;

export class AuthoringError extends Error {}

/**
 * DI authoring pipeline (Phase 3): generate → validate → FREEZE.
 * Generation and validation happen here at authoring time; delivery is
 * verbatim replay of the frozen files (D2). Routing guard: composites are
 * rejected by validateRoutine before any generation is attempted.
 */
export async function authorRoutine(
  skill: SkillDefinition,
  provider: LLMProvider,
  maxAttempts = 2
): Promise<Routine> {
  // Fail fast on misrouting before spending a model call.
  const routing = validateRoutine({ skill_id: skill.skill_id, stages: [] }, skill);
  if (routing.errors.some((e) => e.includes("CASE ENGINE"))) {
    throw new AuthoringError(routing.errors[0]);
  }

  let lastErrors: string[] = [];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const raw = await provider.complete({
      system: SYSTEM,
      prompt:
        `Author the routine for:\nSkill: ${skill.name} (${skill.concept_type})\nDescription: ${skill.description}` +
        (lastErrors.length
          ? `\n\nYour previous routine was rejected:\n${lastErrors.join("\n")}\nFix these and regenerate.`
          : ""),
      json: true,
      temperature: 0,
      maxTokens: 4096,
    });
    const candidate = {
      skill_id: skill.skill_id,
      stages: (JSON.parse(extractJson(raw)).stages ?? []).map((s: Record<string, unknown>) => ({
        ...s,
        skill_id: skill.skill_id,
      })),
    };
    const v = validateRoutine(candidate, skill);
    if (v.valid) {
      const routine = Routine.parse(candidate);
      // FREEZE: stamp each stage with its content hash — the delivery
      // layer's verbatim-replay check verifies against this.
      routine.stages = routine.stages.map((st) => ({ ...st, content_hash: stageContentHash(st) }));
      return routine;
    }
    lastErrors = v.errors;
  }
  throw new AuthoringError(
    `Could not author a valid routine for ${skill.skill_id}: ${lastErrors.join("; ")}`
  );
}

/** Persist frozen routine files: Skills/{id}/routine/{stage_id}.json */
export async function writeRoutine(routine: Routine, rootDir: string): Promise<void> {
  const dir = join(rootDir, "Skills", routine.skill_id, "routine");
  await mkdir(dir, { recursive: true });
  for (const stage of routine.stages) {
    if (!stage.content_hash || stage.content_hash !== stageContentHash(stage)) {
      throw new AuthoringError(
        `Refusing to write unfrozen/tampered stage ${stage.stage_id} of ${routine.skill_id}`
      );
    }
    await writeFile(join(dir, `stage_${stage.stage_id}.json`), JSON.stringify(stage, null, 2), "utf8");
  }
}

/** Load a frozen stage, re-verifying the content hash (tamper check). */
export function verifyFrozenStage(stage: RoutineStage): void {
  if (!stage.content_hash || stageContentHash(stage) !== stage.content_hash) {
    throw new AuthoringError(
      `Stage ${stage.stage_id} fails its content-hash check — frozen content was altered; re-author, do not deliver`
    );
  }
}
