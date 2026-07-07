/**
 * Multi-LLM abstraction layer (D9 — mandatory from day one, no provider
 * lock-in in the pedagogical core). Pedagogical code depends only on this
 * interface.
 */
export interface CompletionRequest {
  system?: string;
  prompt: string;
  /** Ask the provider for strict JSON output. */
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMProvider {
  readonly name: string;
  complete(req: CompletionRequest): Promise<string>;
}

/** Anthropic Messages API (fetch-based, no SDK dependency). */
export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  constructor(
    private apiKey: string = process.env.ANTHROPIC_API_KEY ?? "",
    private model: string = "claude-sonnet-5"
  ) {}

  async complete(req: CompletionRequest): Promise<string> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: req.maxTokens ?? 2048,
        temperature: req.temperature ?? 0,
        system: req.system,
        messages: [{ role: "user", content: req.prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
    return data.content.filter((c) => c.type === "text").map((c) => c.text).join("");
  }
}

/** Google Gemini (preferred for high-volume app-side calls per D9). */
export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";
  constructor(
    private apiKey: string = process.env.GOOGLE_API_KEY ?? "",
    private model: string = "gemini-2.0-flash"
  ) {}

  async complete(req: CompletionRequest): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: req.system ? { parts: [{ text: req.system }] } : undefined,
        contents: [{ role: "user", parts: [{ text: req.prompt }] }],
        generationConfig: {
          temperature: req.temperature ?? 0,
          maxOutputTokens: req.maxTokens ?? 2048,
          responseMimeType: req.json ? "application/json" : undefined,
        },
      }),
    });
    if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as {
      candidates: Array<{ content: { parts: Array<{ text?: string }> } }>;
    };
    return data.candidates[0]?.content.parts.map((p) => p.text ?? "").join("") ?? "";
  }
}

/** OpenAI Chat Completions. */
export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  constructor(
    private apiKey: string = process.env.OPENAI_API_KEY ?? "",
    private model: string = "gpt-4o-mini"
  ) {}

  async complete(req: CompletionRequest): Promise<string> {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        temperature: req.temperature ?? 0,
        max_tokens: req.maxTokens ?? 2048,
        response_format: req.json ? { type: "json_object" } : undefined,
        messages: [
          ...(req.system ? [{ role: "system", content: req.system }] : []),
          { role: "user", content: req.prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI API error ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message.content ?? "";
  }
}

/** Deterministic provider for tests — returns canned responses in order. */
export class MockProvider implements LLMProvider {
  readonly name = "mock";
  private i = 0;
  constructor(private responses: string[]) {}
  async complete(): Promise<string> {
    if (this.i >= this.responses.length) throw new Error("MockProvider exhausted");
    return this.responses[this.i++];
  }
}
