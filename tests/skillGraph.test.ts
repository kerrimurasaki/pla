import { describe, expect, it } from "vitest";
import { SkillGraph } from "../src/core/skillGraph.js";
import { SkillDefinition } from "../src/schemas/skill.js";

const skill = (id: string, over: Partial<SkillDefinition> = {}): SkillDefinition =>
  SkillDefinition.parse({
    skill_id: id,
    name: id,
    description: id,
    concept_type: "cognitive_routine",
    mastery_criteria: { threshold: 0.85, required_consecutive: 5 },
    ...over,
  });

describe("SkillGraph (typed dependency DAG — Phase 1)", () => {
  it("accepts a valid DAG", () => {
    const g = new SkillGraph();
    g.add(skill("npv"));
    g.add(skill("dcf", { prerequisites: ["npv"] }));
    g.add(skill("wacc", { prerequisites: ["npv"] }));
    expect(g.validate().valid).toBe(true);
  });

  it("rejects dependency cycles", () => {
    const g = new SkillGraph();
    g.add(skill("a", { prerequisites: ["b"] }));
    g.add(skill("b", { prerequisites: ["a"] }));
    const v = g.validate();
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.includes("cycle"))).toBe(true);
  });

  it("rejects unresolved prerequisites", () => {
    const g = new SkillGraph();
    g.add(skill("dcf", { prerequisites: ["ghost"] }));
    expect(g.validate().errors[0]).toContain("unresolved prerequisite");
  });

  it("enforces decomposition duty: composites must have well-structured components (D4)", () => {
    const g = new SkillGraph();
    g.add(skill("valuation_choice", { concept_type: "ill_structured_composite" }));
    const v = g.validate();
    expect(v.valid).toBe(false);
    expect(v.errors[0]).toContain("must be decomposed");
  });

  it("rejects composite components that are themselves composites", () => {
    const g = new SkillGraph();
    g.add(skill("inner", { concept_type: "ill_structured_composite", component_skill_ids: ["wacc"] }));
    g.add(skill("wacc"));
    g.add(
      skill("outer", { concept_type: "ill_structured_composite", component_skill_ids: ["inner"] })
    );
    const v = g.validate();
    expect(v.errors.some((e) => e.includes("components must be classic types"))).toBe(true);
  });

  it("computes the prerequisite closure for diagnostic traces (advisory, D5)", () => {
    const g = new SkillGraph();
    g.add(skill("arith"));
    g.add(skill("npv", { prerequisites: ["arith"] }));
    g.add(skill("dcf", { prerequisites: ["npv"] }));
    expect(g.prerequisiteClosure("dcf").sort()).toEqual(["arith", "npv"]);
  });
});
