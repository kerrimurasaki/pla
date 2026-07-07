# Personal Learning Agent — Core Engine (Phase 1)

TypeScript core for the personal learning agent described in [CLAUDE.md](CLAUDE.md).
This is the **Phase 1 deliverable**: schemas, invariants, event log, mode contracts —
every rule in the master prompt's §3 maps to a checkable code path, schema constraint, or test.

No UI yet, by design: *"the pedagogical engine must be trustworthy before it earns ambient reach."*

## What's implemented

| Phase 1 requirement | Where | Enforced how |
|---|---|---|
| File architecture | `LearningAgent/` scaffold + path conventions in `EventLog`/`GapsQueue` | directory layout per master prompt |
| Six-type `classify_concept` | [classifier.ts](src/core/classifier.ts) | LLM proposes; four-question routing test re-checked deterministically; inconsistent or undecomposed classifications throw |
| Four-question test as eval set | [concept-classification.json](evals/concept-classification.json) | 20 labeled cases; `npm run eval:classifier` runs them against a real provider |
| Skill-graph DAG | [skillGraph.ts](src/core/skillGraph.ts) | cycle detection, reference resolution, decomposition duty (D4) |
| Append-only hash-chained event log | [eventLog.ts](src/core/eventLog.ts), [hashchain.ts](src/core/hashchain.ts) | JSONL append; chain fields computed by the log, not callers; Tier 3 rejected at the API (Invariant 3) |
| Mode-contract state machine | [modes.ts](src/core/modes.ts) | offer-once-per-node, ≤2 micro-diagnostics/pause, verbatim-replay guard, abort→block-top restart, stage-grain checkpoints (D2) |
| Invariant validators | [invariants.ts](src/validators/invariants.ts) | shortcut checks, case-fact-anchored rubrics, grounding/provenance, ≤30% covertization fade, routing rule, claim eligibility (D5/D7) |
| Multi-LLM abstraction | [provider.ts](src/llm/provider.ts) | Anthropic / Gemini / OpenAI behind one interface (D9); pedagogical code never imports a vendor SDK |

## Commands

```bash
npm install
npm test              # invariant test suite (the §3 rule → test mapping)
npm run typecheck
npm run eval:classifier   # needs ANTHROPIC_API_KEY / GOOGLE_API_KEY / OPENAI_API_KEY
```

## Design notes for reviewers (Kerri)

- **Tier-3 rejection is structural**: `EventLog.append` throws on tier 3; ambient signal
  has exactly one write target, `GapsQueue`. `checkClaimEligibility` re-checks anyway
  because claims may bundle imported evidence.
- **Verbatim replay is hash-verified**: `stageContentHash` freezes authored stages;
  `ModeMachine.deliverStep` rejects any wording that differs from the frozen file.
- **The classifier never silently misroutes**: if the model's type disagrees with its own
  four-question answers (threshold: ≥3 yes → case engine), we throw rather than accept.
  That threshold is a design judgment — flagging per the working agreements.
- **Tunables (D8)** live in each skill's `mastery_criteria.criss_crossing`, so the
  criss-crossing gate can be adjusted per the kill criteria without code changes.

## Next (Phase 2)

Goal-to-graph pipeline: job-ad ingestion, SkillsFuture taxonomy mapping, personal
skill-graph generation, diagnostic micro-assessment flow. The `map_to_taxonomy` and
`fetch_grounded_source` tools land there.
