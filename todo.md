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
- [ ] **Real SkillsFuture taxonomy scrape/normalization** (Firecrawl or equivalent) — currently only the cache schema + loader exist; tests use a sample fixture
- [ ] **Diagnostic flow wiring** — running a generated item, assessing the response, and appending the mastery event exists as parts (EventLog, ModeMachine, validators) but isn't wired as one flow yet
- [ ] **CLI/entry point** to run the pipeline against a real provider end-to-end (currently library + tests only)
- [ ] Run the pipeline once on a real job ad with a real provider; record findings here

## Phase 3 — Instruction & practice engine (not started)
## Phase 4 — Case engine (not started)
## Phase 5 — Assessment & credential layer (not started)
- [ ] External chain-root anchoring mechanism decision
## Phase 6 — Ambient browser integration & pilot (not started)
