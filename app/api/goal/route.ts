import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ingestGoalText,
  goalToGraph,
  AnthropicProvider,
  GeminiProvider,
  OpenAIProvider,
  TaxonomyCacheFile,
} from "../../../dist/index.js";
import type { LLMProvider, LearnerGoal } from "../../../dist/index.js";
// Static import so the bundler includes this file regardless of file-tracing
// config — no filesystem read of repo-relative paths needed at runtime.
import sampleTaxonomyRaw from "../../../LearningAgent/Taxonomies/skillsfuture_sample/entries.json";

// The pipeline makes several sequential LLM calls (extraction, per-skill
// classification, prerequisites, taxonomy mapping, diagnostics) — request
// the platform's max function duration. Vercel Hobby caps this lower than
// 60s regardless; large job ads may still time out (see README).
export const maxDuration = 60;

function pickProvider(): LLMProvider {
  if (process.env.ANTHROPIC_API_KEY) return new AnthropicProvider();
  if (process.env.GOOGLE_API_KEY) return new GeminiProvider();
  if (process.env.OPENAI_API_KEY) return new OpenAIProvider();
  throw new Error(
    "No LLM provider configured. Set ANTHROPIC_API_KEY, GOOGLE_API_KEY, or OPENAI_API_KEY " +
      "in the Vercel project's environment variables."
  );
}

export async function POST(req: NextRequest) {
  let body: { text?: string; learnerId?: string; kind?: LearnerGoal["kind"] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "Missing required field 'text'." }, { status: 400 });
  }
  const learnerId = body.learnerId?.trim() || `learner_${randomUUID().slice(0, 8)}`;
  const kind = body.kind ?? "job_ad";

  try {
    const provider = pickProvider();
    const cache = TaxonomyCacheFile.parse(sampleTaxonomyRaw);
    const goal = ingestGoalText(learnerId, kind, text);

    // Serverless functions have a read-only filesystem except /tmp; the
    // pipeline's writes (Curriculum/Skills/Learners) go there. Each
    // invocation may run on a fresh container — this is ephemeral, test-only
    // storage, not real persistence (see README/todo.md).
    const rootDir = join(tmpdir(), "pla", randomUUID().slice(0, 8));

    const result = await goalToGraph(goal, cache, provider, rootDir);
    return NextResponse.json({ goal, ...result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
