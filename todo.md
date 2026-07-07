# PLA — Build Tracker

Running log of open items, flagged decisions, and phase progress.
Maintained by Claude Code as engineering happens; Kerri reviews flagged items.

---

## Flagged for Kerri (invariant guardian sign-off needed)

- [ ] **Routing threshold encoding.** The master prompt says route to `ill_structured_composite` when the four-question test is "mostly YES". I encoded this as **≥3 of 4 yes** in `routesToCaseEngine()` ([src/schemas/concept.ts](src/schemas/concept.ts)). One-line change if you want a different rule (e.g. 2/4, or specific questions weighted). Touches sixth-type routing → needs your sign-off per working agreements.
- [ ] **npm audit: 5 vulnerabilities** (3 moderate, 1 high, 1 critical) — all in the vitest 2.x dev-dependency chain. Nothing ships to production. Fix is a bump to vitest 3.x; low urgency, some test-API churn.

## Engineering notes for the record

- **Fixed test (2026-07-05):** first run of the claim-eligibility test failed because the test constructed a **single-constituent claim**, which makes the "integrative Tier 1 task spanning ≥2 constituents" requirement unsatisfiable by construction. Fixed the *test* (two constituents: wacc + dcf), not the validator — the validator was correct. Design note: if a real-world claim ever legitimately has one constituent skill, `checkClaimEligibility` will never pass it. Current position: claims aggregate multiple nodes by definition (D7); revisit only if a one-node claim becomes a real use case.

---

## Phase 1 — Schema & invariants foundation ✅ (2026-07-05)

- [x] File architecture (`LearningAgent/` scaffold, path conventions)
- [x] Zod schemas: 6 concept types, skills, sequences, routines, items, cases, events, claims
- [x] Append-only hash-chained event log; Tier-3 rejection structural
- [x] `deriveMasteryView` incl. criss-crossing coverage for ill-structured skills
- [x] Skill-graph DAG: cycles, reference resolution, decomposition duty
- [x] Mode-contract state machine (offer discipline, verbatim replay, abort/restart, checkpoint grain)
- [x] Invariant validators (shortcut checks, anchored rubrics, fade ≤30%, routing rule, claim gate)
- [x] `classify_concept` with deterministic four-question consistency check
- [x] Multi-LLM abstraction (Anthropic/Gemini/OpenAI, no SDK deps)
- [x] Eval set: 20 labeled concepts (`npm run eval:classifier`)
- [x] 50 tests green, typecheck clean
- [ ] **Classifier eval not yet run against a real provider** — needs an API key; run once and record the score here
- [ ] **Browser-surface spike** (extension vs CDP overlay vs custom shell) — deferred from Phase 1, must happen before Phase 6

## Phase 2 — Goal-to-graph pipeline 🚧 (started 2026-07-05; core landed 2026-07-07)

Deliverable: learner drops in a job ad → typed, gap-marked skill graph within minutes.

- [x] Goal ingestion (pasted text + URL fetch with provenance; `GoalFetcher` interface is Firecrawl-ready)
- [x] Skill extraction (LLM; each skill must quote a verbatim span of the goal text — `GroundingError` otherwise)
- [x] Taxonomy cache + `map_to_taxonomy` (non-null refs must exist in cache — `TaxonomyIntegrityError` on invention; honest nulls allowed)
- [x] Skill-graph generation (classify each skill, composite decomposition → real component nodes, prerequisite edges among known ids only, DAG-validated)
- [x] Diagnostic micro-assessment generation (generate → validate → present; one retry fed the validator's errors; composites refused — components only)
- [x] Orchestrator `goalToGraph` writing `Curriculum/{goal_id}/` (original.txt, analysis.json, skill_graph.json, diagnostics/), `Skills/{id}/definition.json`, `Learners/{id}/profile.json`
- [x] Tests with MockProvider (11 tests; end-to-end job-ad → 4-node typed graph incl. decomposed composite)
- [x] Diagnostic flow wiring — `runDiagnosticFlow`: item → `assessResponse` (exact-match short-circuit, LLM judge for equivalence + error-pattern match, authored feedback verbatim) → Tier-2 event appended → gap status bumped to `in_progress` (never to `verified` — that only comes from a derived view meeting the gate)
- [x] CLI entry point — `npm run pla -- goal <path-or-url> [--learner id] [--kind job_ad] [--taxonomy id] [--root dir]`; provider picked from env keys
- [ ] **Real SkillsFuture taxonomy scrape/normalization** (Firecrawl or equivalent) — `LearningAgent/Taxonomies/skillsfuture_sample/entries.json` is a clearly-labeled PLACEHOLDER with illustrative refs; replace with a real scrape before any learner-facing use
- [ ] Run the pipeline once on a real job ad with a real provider; record findings here (needs an API key in env)

## Phase 3 — Instruction & practice engine 🚧 (started 2026-07-07)

- [x] DI authoring pipeline: `authorRoutine` (generate → validate → FREEZE with per-stage content hashes; misrouted composites rejected before any model call; retry fed the validator's errors)
- [x] Example-sequence authoring: `authorExampleSequence` (same generate→validate→retry pattern; juxtaposition blocks required)
- [x] Frozen-file persistence: `writeRoutine` refuses unfrozen/tampered stages; `verifyFrozenStage` re-checks hashes at load
- [x] Focus-DI delivery: `DISession` — hash-verified stage load, verbatim direction replay (ModeMachine guard), correction protocol (error → verbatim error_feedback → correct production → restart problem from beginning), abort → block-top restart, checkpoint at stage boundary only
- [x] Adaptive support logic (advisory form): `AdvisorySession` — fade after 3 consecutive correct, restore after 2 consecutive failures, prereq nudge + cost visibility once per session per node; the `Advisory` type admits no blocking action
- [ ] **DI delivery events not yet wired to the EventLog** — `DISession` reports step results but doesn't append practice events; wire stage-completion outcomes into `EventLog` (support_stage recorded) so covertization progress feeds mastery analytics
- [ ] **Example-sequence delivery** — sequences are authored + validated but there's no delivery runner yet (multi-block, restart-at-block-top uses ModeMachine which already supports it)
- [ ] Practice-item generation at a given difficulty/support level (generalize `generateDiagnostic` — add `difficulty_stage` targeting)
- [ ] Overlapping fading schedules (Lesson 4: 2 examples at Original then 4 at Stage A) — schema supports stages; scheduler doesn't exist
- [ ] `corrections.json` authoring (predictable-error corrections beyond per-step error_feedback)
## Phase 4 — Case engine (not started)
## Phase 5 — Assessment & credential layer (not started)
- [ ] External chain-root anchoring mechanism decision
## Phase 6 — Ambient browser integration & pilot (not started)
