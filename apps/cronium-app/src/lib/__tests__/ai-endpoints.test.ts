/**
 * @jest-environment node
 *
 * A user's AI connection names its own base URL, so it is held to the SSRF guard. An
 * administrator's endpoint, or an instance that opted in, may be on the LAN.
 */
jest.mock("openai", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock("@google/genai", () => ({ GoogleGenAI: jest.fn() }));
jest.mock("@/server/storage", () => ({
  storage: { getSetting: jest.fn() },
}));
jest.mock("../resolve-host", () => ({ resolveHost: jest.fn() }));

jest.mock("../../env.mjs", () => ({ env: {} }));

import OpenAI from "openai";
import { resolveHost } from "../resolve-host";
import { getAiConfig, generateText, listAvailableModels } from "../ai";
import { ssrfGuardedFetch } from "../ssrf-guard";
import { storage } from "@/server/storage";
import { env } from "../../env.mjs";

const mockOpenAI = OpenAI as unknown as jest.Mock;
const mockModelsList = jest.fn();
const mockCreate = jest.fn();
const mockEnv = env as unknown as Record<string, string | undefined>;
const mockResolveHost = resolveHost as unknown as jest.Mock;
const mockGetSetting = storage.getSetting as jest.Mock;

// eslint-disable-next-line @typescript-eslint/require-await
async function* oneModel() {
  yield { id: "llama3" };
}

beforeEach(() => {
  jest.clearAllMocks();
  delete mockEnv.CRONIUM_AI_ALLOW_PRIVATE_URLS;
  mockOpenAI.mockImplementation(() => ({
    models: { list: mockModelsList },
    chat: { completions: { create: mockCreate } },
  }));
  mockModelsList.mockImplementation(() => oneModel());
  mockCreate.mockResolvedValue({
    choices: [{ message: { content: "hi" }, finish_reason: "stop" }],
  });
  mockGetSetting.mockResolvedValue(undefined);
  mockResolveHost.mockResolvedValue([{ address: "198.51.100.1", family: 4 }]);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("listAvailableModels", () => {
  it("guards a public endpoint a user supplied", async () => {
    const result = await listAvailableModels(
      "custom",
      "key",
      "https://llm.example.com/v1",
    );

    expect(result.source).toBe("provider");
    expect(mockOpenAI).toHaveBeenCalledWith({
      apiKey: "key",
      baseURL: "https://llm.example.com/v1",
      fetch: ssrfGuardedFetch,
    });
  });

  it.each([
    "http://169.254.169.254/latest/meta-data/iam?x=",
    "http://127.0.0.1:11434/v1",
    "http://[::ffff:169.254.169.254]/",
  ])("refuses %s from a user, naming the setting", async (url) => {
    const result = await listAvailableModels("custom", "key", url);

    expect(result.source).toBe("fallback");
    expect(result.error).toContain("CRONIUM_AI_ALLOW_PRIVATE_URLS");
    expect(mockOpenAI).not.toHaveBeenCalled();
  });

  it("refuses a hostname that resolves internally", async () => {
    mockResolveHost.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);

    const result = await listAvailableModels(
      "custom",
      "key",
      "http://ollama.internal/v1",
    );

    expect(result.source).toBe("fallback");
    expect(mockOpenAI).not.toHaveBeenCalled();
  });

  it("allows an internal endpoint once the instance opts in", async () => {
    mockEnv.CRONIUM_AI_ALLOW_PRIVATE_URLS = "true";

    const result = await listAvailableModels(
      "custom",
      "key",
      "http://127.0.0.1:11434/v1",
    );

    expect(result.source).toBe("provider");
    expect(mockOpenAI).toHaveBeenCalledWith({
      apiKey: "key",
      baseURL: "http://127.0.0.1:11434/v1",
    });
  });

  it("trusts an administrator naming the endpoint", async () => {
    const result = await listAvailableModels(
      "custom",
      "key",
      "http://10.0.0.5:11434/v1",
      { trustedBaseUrl: true },
    );

    expect(result.source).toBe("provider");
    expect(mockOpenAI).toHaveBeenCalledWith({
      apiKey: "key",
      baseURL: "http://10.0.0.5:11434/v1",
    });
  });

  it("trusts the administrator's saved endpoint", async () => {
    mockGetSetting.mockImplementation((key: string) =>
      Promise.resolve(
        key === "customAiBaseUrl"
          ? { value: "http://10.0.0.5:11434/v1" }
          : undefined,
      ),
    );

    const result = await listAvailableModels("custom", "key");

    expect(result.source).toBe("provider");
    expect(mockOpenAI).toHaveBeenCalledWith({
      apiKey: "key",
      baseURL: "http://10.0.0.5:11434/v1",
    });
  });
});

describe("generateText", () => {
  it("refuses an internal endpoint on a user's connection", async () => {
    await expect(
      generateText(
        {
          provider: "custom",
          model: "m",
          apiKey: "key",
          baseUrl: "http://169.254.169.254/v1",
        },
        { userPrompt: "hi" },
      ),
    ).rejects.toThrow("CRONIUM_AI_ALLOW_PRIVATE_URLS");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("uses the guard for a public endpoint on a user's connection", async () => {
    await generateText(
      {
        provider: "custom",
        model: "m",
        apiKey: "key",
        baseUrl: "https://llm.example.com/v1",
      },
      { userPrompt: "hi" },
    );

    expect(mockOpenAI).toHaveBeenCalledWith({
      apiKey: "key",
      baseURL: "https://llm.example.com/v1",
      fetch: ssrfGuardedFetch,
    });
  });

  it("leaves the administrator's configured endpoint alone", async () => {
    mockGetSetting.mockImplementation((key: string) =>
      Promise.resolve(
        {
          aiProvider: { value: "custom" },
          aiModel: { value: "m" },
          customAiApiKey: { value: "key" },
          customAiBaseUrl: { value: "http://10.0.0.5:11434/v1" },
        }[key],
      ),
    );

    const config = await getAiConfig();
    await generateText(config, { userPrompt: "hi" });

    expect(mockOpenAI).toHaveBeenCalledWith({
      apiKey: "key",
      baseURL: "http://10.0.0.5:11434/v1",
    });
  });
});
