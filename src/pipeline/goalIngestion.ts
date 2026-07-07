import { randomUUID } from "node:crypto";
import { LearnerGoal } from "../schemas/goal.js";

export interface GoalFetcher {
  /** Fetch a URL and return plain text (Firecrawl slots in here later — D9). */
  fetchText(url: string): Promise<string>;
}

/** Plain-fetch fallback fetcher: naive HTML → text. */
export class SimpleFetcher implements GoalFetcher {
  async fetchText(url: string): Promise<string> {
    const res = await fetch(url, { headers: { accept: "text/html,text/plain" } });
    if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
    const body = await res.text();
    return htmlToText(body);
  }
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Ingest pasted goal text with provenance. */
export function ingestGoalText(
  learnerId: string,
  kind: LearnerGoal["kind"],
  text: string
): LearnerGoal {
  return LearnerGoal.parse({
    goal_id: `goal_${randomUUID().slice(0, 8)}`,
    learner_id: learnerId,
    kind,
    raw_text: text.trim(),
    source: { type: "pasted_text", retrieved_at: new Date().toISOString() },
  });
}

/** Ingest a goal from a URL (job ad page etc.) with provenance. */
export async function ingestGoalUrl(
  learnerId: string,
  kind: LearnerGoal["kind"],
  url: string,
  fetcher: GoalFetcher = new SimpleFetcher()
): Promise<LearnerGoal> {
  const text = await fetcher.fetchText(url);
  if (!text.trim()) throw new Error(`No text content retrieved from ${url}`);
  return LearnerGoal.parse({
    goal_id: `goal_${randomUUID().slice(0, 8)}`,
    learner_id: learnerId,
    kind,
    raw_text: text,
    source: { type: "url", url, retrieved_at: new Date().toISOString() },
  });
}
