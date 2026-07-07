import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ExampleSequence } from "../schemas/instruction.js";
import { SkillDefinition } from "../schemas/skill.js";
import { validateExampleSequence } from "../validators/invariants.js";
import { LLMProvider } from "../llm/provider.js";
import { extractJson } from "../util/json.js";
import { AuthoringError } from "./routineAuthor.js";

const SYSTEM = `You author an Engelmann example sequence for a well-structured concept.

Principles (machine-rejected otherwise):
- Show SAMENESS: juxtapose maximally different positives that get the same response.
- Show DIFFERENCE: juxtapose minimum-difference negatives that get different responses.
- Never progressive ordering (don't show change 1, 2, 3 — implies the amount matters).
- Wording template identical across ALL examples ("Is this ___?" — non-comparative wording for non-comparatives).
- Test examples NOVEL: never repeat a modeled stimulus.
- Mark juxtaposition blocks: atomic runs whose teaching power is in adjacency — delivery restarts aborted sequences from a block top.
- Sequence type by concept: negative_first (many non-comparatives), positive_first (nouns), comparative (comparatives: starting point → varied positives → no-change negatives).

Respond with ONLY JSON:
{
  "sequence_type": "negative_first|positive_first|comparative",
  "wording_template": "...",
  "examples": [ { "example_id": "e1", "kind": "positive|negative|test", "stimulus": "...", "expected_response": "...", "minimum_difference_of": "<optional example_id>" } ],
  "juxtaposition_blocks": [ { "block_id": "b1", "example_ids": ["e1", "e2"] } ]
}`;

/**
 * Author an example sequence: generate → validate → return for freezing.
 * Same authoring-time/delivery-time split as routines.
 */
export async function authorExampleSequence(
  skill: SkillDefinition,
  provider: LLMProvider,
  maxAttempts = 2
): Promise<ExampleSequence> {
  let lastErrors: string[] = [];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const raw = await provider.complete({
      system: SYSTEM,
      prompt:
        `Author the example sequence for:\nSkill: ${skill.name} (${skill.concept_type})\nDescription: ${skill.description}` +
        (lastErrors.length
          ? `\n\nYour previous sequence was rejected:\n${lastErrors.join("\n")}\nFix these and regenerate.`
          : ""),
      json: true,
      temperature: 0,
      maxTokens: 4096,
    });
    const candidate = { ...JSON.parse(extractJson(raw)), skill_id: skill.skill_id };
    const v = validateExampleSequence(candidate, skill);
    if (v.valid) return ExampleSequence.parse(candidate);
    lastErrors = v.errors;
  }
  throw new AuthoringError(
    `Could not author a valid example sequence for ${skill.skill_id}: ${lastErrors.join("; ")}`
  );
}

/** Persist: Skills/{id}/examples/sequence.json */
export async function writeSequence(seq: ExampleSequence, rootDir: string): Promise<void> {
  const dir = join(rootDir, "Skills", seq.skill_id, "examples");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "sequence.json"), JSON.stringify(seq, null, 2), "utf8");
}
