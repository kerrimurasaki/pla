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

## Phase 2 — Goal-to-graph pipeline (core landed)

| Piece | Where | Guarantee |
|---|---|---|
| Goal ingestion | [goalIngestion.ts](src/pipeline/goalIngestion.ts) | provenance recorded; `GoalFetcher` interface is Firecrawl-ready |
| Skill extraction | [skillExtraction.ts](src/pipeline/skillExtraction.ts) | every skill quotes a verbatim span of the goal text, else `GroundingError` |
| Taxonomy mapping | [taxonomy.ts](src/core/taxonomy.ts) | refs must exist in the cached taxonomy — never invented (D9); honest nulls allowed |
| Graph builder | [graphBuilder.ts](src/pipeline/graphBuilder.ts) | six-type classification per skill, composites decomposed into real nodes, DAG-validated |
| Diagnostics | [diagnostics.ts](src/pipeline/diagnostics.ts) | generate → validate against invariants → present; composites refused (case-assessed only) |
| Orchestrator | [goalToGraph.ts](src/pipeline/goalToGraph.ts) | job ad → typed, gap-marked graph + diagnostics, persisted per the file architecture; all nodes start `unverified` |

Progress and open items are tracked in [todo.md](todo.md).

## Vercel test harness

A minimal Next.js 14 App Router wrapper exists purely to smoke-test the pipeline from a
browser instead of the CLI. It is **not** the product UI — see CLAUDE.md D2/D9 for why
the real browser surface is a Phase 6 concern.

- `GET /` — bare form: paste a job ad, see the resulting graph as JSON
- `POST /api/goal` — `{ text, learnerId?, kind? }` → runs `goalToGraph` server-side

Local commands:
```bash
npm run build:lib   # compiles src/ -> dist/ (the API route imports the compiled output)
npm run dev         # next dev (runs build:lib first via `predev`)
npm run build       # next build (for Vercel this runs automatically as `vercel-build`)
```

Deploying: import the repo in Vercel (github.com/kerrimurasaki/pla), then set
`ANTHROPIC_API_KEY` (or `GOOGLE_API_KEY` / `OPENAI_API_KEY`) in the project's
Environment Variables before the first deploy. Pipeline output is written to
`/tmp` at request time — Vercel's filesystem is read-only elsewhere, and `/tmp`
is ephemeral per invocation, so nothing persists between requests yet.

## Next (Phase 3 / parallel Phase 4)

Instruction & practice engine: DI authoring pipeline (generate → validate → freeze
verbatim routine files), Focus-DI delivery with atomicity enforcement, adaptive
support logic in advisory form. Phase 4 (case engine) can partially parallelize.
