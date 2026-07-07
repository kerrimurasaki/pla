import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assessResponse, runDiagnosticFlow } from "../src/pipeline/assessment.js";
import { MockProvider } from "../src/llm/provider.js";
import { PracticeItem } from "../src/schemas/item.js";
import { EventLog } from "../src/core/eventLog.js";

const item: PracticeItem = PracticeItem.parse({
  item_id: "diag_1",
  skill_id: "wacc_calculation",
  stimulus: "Given equity 60%, debt 40%, cost of equity 10%, pre-tax cost of debt 5%, tax 25% — what is WACC?",
  correct_response: "7.5%",
  skill_requirement: "Full WACC computation with tax shield",
  novel: true,
  shortcut_check: {
    pattern_matching_possible: false,
    process_of_elimination_possible: false,
    memorization_possible: false,
  },
  common_errors: [
    {
      error: "Uses pre-tax cost of debt",
      diagnosis: "Skips the tax shield",
      feedback:
        "You used the pre-tax cost of debt. Interest is tax-deductible, so multiply 5% by (1 - 0.25) before weighting.",
    },
  ],
});

describe("assessResponse (well-structured production items)", () => {
  it("short-circuits on a normalized exact match without an LLM call", async () => {
    const a = await assessResponse(item, "  7.5% ", new MockProvider([]));
    expect(a).toEqual({ correct: true, matched_error: null, feedback: "" });
  });

  it("judge equivalence: differently-phrased correct answers pass", async () => {
    const judge = JSON.stringify({ correct: true, matched_error: null, feedback: "" });
    const a = await assessResponse(item, "0.075, i.e. seven and a half percent", new MockProvider([judge]));
    expect(a.correct).toBe(true);
  });

  it("known error patterns return the AUTHORED feedback verbatim", async () => {
    const judge = JSON.stringify({ correct: false, matched_error: 0, feedback: "" });
    const a = await assessResponse(item, "8%", new MockProvider([judge]));
    expect(a.matched_error).toBe(0);
    expect(a.feedback).toBe(item.common_errors[0].feedback);
  });

  it("rejects incorrect verdicts that arrive without specific feedback", async () => {
    const judge = JSON.stringify({ correct: false, matched_error: null, feedback: "  " });
    await expect(assessResponse(item, "9%", new MockProvider([judge]))).rejects.toThrow(/specific feedback/);
  });
});

describe("runDiagnosticFlow (item → assess → event → gap status)", () => {
  it("appends a Tier 2 micro_diagnostic event and bumps the node to in_progress", async () => {
    const root = await mkdtemp(join(tmpdir(), "pla-flow-"));
    const goalId = "goal_test";
    const graphPath = join(root, "Curriculum", goalId);
    await mkdir(graphPath, { recursive: true });
    await writeFile(
      join(graphPath, "skill_graph.json"),
      JSON.stringify({
        goal_id: goalId,
        learner_id: "alice",
        generated_at: new Date().toISOString(),
        nodes: [],
        gap_status: [{ skill_id: "wacc_calculation", status: "unverified" }],
      }),
      "utf8"
    );

    const result = await runDiagnosticFlow(item, "7.5%", {
      learner_id: "alice",
      goal_id: goalId,
      provider: new MockProvider([]),
      rootDir: root,
    });

    expect(result.assessment.correct).toBe(true);
    expect(result.gap_status).toBe("in_progress");

    const log = new EventLog(root);
    const events = await log.read("alice", "wacc_calculation");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event_type: "micro_diagnostic", tier: 2, correct: true });
    expect((await log.verify("alice", "wacc_calculation")).valid).toBe(true);

    const persisted = JSON.parse(await readFile(join(graphPath, "skill_graph.json"), "utf8"));
    expect(persisted.gap_status[0].status).toBe("in_progress");
  });
});
