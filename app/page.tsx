"use client";

import { useState } from "react";

export default function Home() {
  const [text, setText] = useState("");
  const [learnerId, setLearnerId] = useState("test_learner");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/goal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, learnerId, kind: "job_ad" }),
      });
      const data = await res.json();
      setResult(JSON.stringify(data, null, 2));
    } catch (err) {
      setResult(`Request failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 720 }}>
      <h1>PLA — goal-to-graph test harness</h1>
      <p>
        Paste a job ad / position description / task below. This calls <code>POST /api/goal</code>,
        which runs the Phase 2 pipeline (skill extraction → classification → graph → diagnostics)
        against whichever LLM API key is configured server-side, and writes pipeline output to{" "}
        <code>/tmp</code> (ephemeral — not persisted between requests).
      </p>
      <label style={{ display: "block", marginBottom: 8 }}>
        Learner id: <input value={learnerId} onChange={(e) => setLearnerId(e.target.value)} />
      </label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        style={{ width: "100%", boxSizing: "border-box" }}
        placeholder="Paste a job ad here..."
      />
      <div style={{ marginTop: 12 }}>
        <button onClick={run} disabled={loading || !text.trim()}>
          {loading ? "Running pipeline… (can take up to a minute)" : "Run pipeline"}
        </button>
      </div>
      {result && (
        <pre style={{ background: "#f4f4f4", padding: 16, marginTop: 16, overflowX: "auto" }}>{result}</pre>
      )}
    </main>
  );
}
