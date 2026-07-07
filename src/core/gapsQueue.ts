import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

/**
 * Ambient mode's ONLY legal write target for skill-gap signal (D2).
 * Telemetry-derived hypotheses land here; they never touch mastery.
 */
export const CandidateGap = z.object({
  skill_hypothesis: z.string(),
  signal: z.enum(["dwell", "scroll", "hover", "page_read", "search_pattern", "composition_struggle"]),
  context_url: z.string().optional(),
  error_hypothesis: z.string().optional(),
  observed_at: z.string().datetime(),
});
export type CandidateGap = z.infer<typeof CandidateGap>;

export class GapsQueue {
  constructor(private rootDir: string) {}

  private path(learnerId: string): string {
    return join(this.rootDir, "Learners", learnerId, "gaps_queue.json");
  }

  async read(learnerId: string): Promise<CandidateGap[]> {
    try {
      const raw = await readFile(this.path(learnerId), "utf8");
      return z.array(CandidateGap).parse(JSON.parse(raw));
    } catch (err: any) {
      if (err?.code === "ENOENT") return [];
      throw err;
    }
  }

  async enqueue(learnerId: string, gap: CandidateGap): Promise<void> {
    const gaps = await this.read(learnerId);
    gaps.push(CandidateGap.parse(gap));
    const p = this.path(learnerId);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, JSON.stringify(gaps, null, 2), "utf8");
  }
}
