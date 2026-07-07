import { createHash } from "node:crypto";
import { GENESIS_HASH, MasteryEvent } from "../schemas/events.js";

/** Canonical event hash: sha256(item, response, assessment, timestamp, prior). */
export function computeEventHash(fields: {
  item_ref: string;
  response_ref: string;
  assessment_ref: string;
  timestamp: string;
  prior_event_hash: string;
}): string {
  const canonical = JSON.stringify([
    fields.item_ref,
    fields.response_ref,
    fields.assessment_ref,
    fields.timestamp,
    fields.prior_event_hash,
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export interface ChainVerification {
  valid: boolean;
  length: number;
  /** Index of the first broken link, if any. */
  broken_at?: number;
  reason?: string;
}

/** Verify a full per-learner×skill chain from genesis. */
export function verifyChain(events: MasteryEvent[]): ChainVerification {
  let prior = GENESIS_HASH;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.prior_event_hash !== prior) {
      return { valid: false, length: events.length, broken_at: i, reason: "prior_event_hash mismatch" };
    }
    const expected = computeEventHash(e);
    if (e.event_hash !== expected) {
      return { valid: false, length: events.length, broken_at: i, reason: "event_hash mismatch (tampered payload)" };
    }
    prior = e.event_hash;
  }
  return { valid: true, length: events.length };
}

/** Chain root = hash over the ordered event hashes (anchored externally, Phase 5). */
export function chainRoot(events: MasteryEvent[]): string {
  const h = createHash("sha256");
  for (const e of events) h.update(e.event_hash, "utf8");
  return h.digest("hex");
}
