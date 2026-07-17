/**
 * @jest-environment node
 */
jest.mock("@/lib/ai", () => ({ generateText: jest.fn() }));

import { generateText } from "@/lib/ai";
import { promptAction } from "../actions/prompt";
import type { ExecutionContext } from "@/tools/types/tool-plugin";

const mockGenerate = generateText as jest.Mock;

const creds = {
  provider: "openai",
  apiKey: "sk-test",
  defaultModel: "gpt-default",
};

function ctx(timeoutMs?: number): ExecutionContext {
  return {
    variables: { get: jest.fn(), set: jest.fn() },
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
    ...(timeoutMs ? { timeoutMs } : {}),
  };
}

function textResult(overrides: Record<string, unknown> = {}) {
  return {
    text: "hello",
    model: "gpt-default",
    provider: "openai",
    usage: { inputTokens: 10, outputTokens: 5 },
    finishReason: "stop",
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

describe("ai-prompt action", () => {
  it("is registered to emit output (producesOutput)", () => {
    expect(promptAction.id).toBe("ai-prompt");
    expect(promptAction.producesOutput).toBe(true);
  });

  it("text mode returns { text, model, provider, usage }", async () => {
    mockGenerate.mockResolvedValue(textResult());
    const out = await promptAction.execute(creds, { userPrompt: "hi" }, ctx());
    expect(out).toMatchObject({
      text: "hello",
      model: "gpt-default",
      provider: "openai",
      usage: { inputTokens: 10, outputTokens: 5 },
    });
  });

  it("builds the config from the credential and passes prompt options", async () => {
    mockGenerate.mockResolvedValue(textResult());
    await promptAction.execute(
      { provider: "custom", apiKey: "k", baseUrl: "https://x/v1" },
      { userPrompt: "hi", model: "qwen", maxTokens: 123, temperature: 0.5 },
      ctx(5000),
    );
    const [config, opts] = mockGenerate.mock.calls[0];
    expect(config).toMatchObject({
      provider: "custom",
      model: "qwen",
      apiKey: "k",
      baseUrl: "https://x/v1",
    });
    expect(opts).toMatchObject({
      userPrompt: "hi",
      maxTokens: 123,
      temperature: 0.5,
      responseFormat: "text",
    });
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it("resolves the model: action param > connection default", async () => {
    mockGenerate.mockResolvedValue(textResult());
    await promptAction.execute(creds, { userPrompt: "hi" }, ctx());
    expect(mockGenerate.mock.calls[0][0].model).toBe("gpt-default");

    mockGenerate.mockResolvedValue(textResult());
    await promptAction.execute(
      creds,
      { userPrompt: "hi", model: "override" },
      ctx(),
    );
    expect(mockGenerate.mock.calls[1][0].model).toBe("override");
  });

  it("fails when no model can be resolved (custom w/o default)", async () => {
    const out = await promptAction.execute(
      { provider: "custom", apiKey: "k", baseUrl: "https://x/v1" },
      { userPrompt: "hi" },
      ctx(),
    );
    expect(out.success).toBe(false);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("json mode parses an object and spreads it with _ai metadata", async () => {
    mockGenerate.mockResolvedValue(
      textResult({ text: '{"flag": true, "score": 3}' }),
    );
    const out = await promptAction.execute(
      creds,
      { userPrompt: "hi", responseFormat: "json" },
      ctx(),
    );
    expect(out).toMatchObject({ flag: true, score: 3 });
    expect(out._ai).toMatchObject({ model: "gpt-default", provider: "openai" });
    expect(out.text).toBeUndefined();
  });

  it("json mode strips a ```json code fence before parsing", async () => {
    mockGenerate.mockResolvedValue(
      textResult({ text: '```json\n{"ok": 1}\n```' }),
    );
    const out = await promptAction.execute(
      creds,
      { userPrompt: "hi", responseFormat: "json" },
      ctx(),
    );
    expect(out).toMatchObject({ ok: 1 });
  });

  it("json mode wraps arrays/scalars under `result`", async () => {
    mockGenerate.mockResolvedValue(textResult({ text: "[1,2,3]" }));
    const out = await promptAction.execute(
      creds,
      { userPrompt: "hi", responseFormat: "json" },
      ctx(),
    );
    expect(out.result).toEqual([1, 2, 3]);
  });

  it("json mode fails cleanly on non-JSON output", async () => {
    mockGenerate.mockResolvedValue(textResult({ text: "not json at all" }));
    const out = await promptAction.execute(
      creds,
      { userPrompt: "hi", responseFormat: "json" },
      ctx(),
    );
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/valid JSON/i);
  });

  it("returns a failure result when the provider call throws", async () => {
    mockGenerate.mockRejectedValue(new Error("401 bad key"));
    const out = await promptAction.execute(creds, { userPrompt: "hi" }, ctx());
    expect(out).toMatchObject({ success: false, error: "401 bad key" });
  });
});
