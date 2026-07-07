import { describe, expect, it } from "vitest";
import { computeEventHash, verifyChain, chainRoot } from "../src/core/hashchain.js";
import { GENESIS_HASH, MasteryEvent } from "../src/schemas/events.js";

function makeEvent(i: number, prior: string): MasteryEvent {
  const base = {
    event_id: `e${i}`,
    learner_id: "alice",
    skill_id: "wacc",
    event_type: "practice_item" as const,
    tier: 2 as const,
    item_ref: `item_${i}`,
    response_ref: `resp_${i}`,
    assessment_ref: `assess_${i}`,
    correct: true,
    timestamp: `2026-07-05T09:0${i}:00Z`,
    prior_event_hash: prior,
  };
  return { ...base, event_hash: computeEventHash(base) };
}

function makeChain(n: number): MasteryEvent[] {
  const events: MasteryEvent[] = [];
  let prior = GENESIS_HASH;
  for (let i = 0; i < n; i++) {
    const e = makeEvent(i, prior);
    events.push(e);
    prior = e.event_hash;
  }
  return events;
}

describe("hash chain (D7 — tamper-evident mechanically)", () => {
  it("verifies an intact chain from genesis", () => {
    expect(verifyChain(makeChain(5))).toEqual({ valid: true, length: 5 });
  });

  it("detects a tampered payload (rewritten assessment)", () => {
    const chain = makeChain(5);
    chain[2] = { ...chain[2], assessment_ref: "assess_FORGED" };
    const v = verifyChain(chain);
    expect(v.valid).toBe(false);
    expect(v.broken_at).toBe(2);
  });

  it("detects a deleted event (broken linkage)", () => {
    const chain = makeChain(5);
    chain.splice(1, 1);
    const v = verifyChain(chain);
    expect(v.valid).toBe(false);
    expect(v.broken_at).toBe(1);
  });

  it("chain root changes when history changes", () => {
    const a = chainRoot(makeChain(5));
    const b = chainRoot(makeChain(4));
    expect(a).not.toEqual(b);
  });
});
