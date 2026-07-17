/**
 * @jest-environment node
 */
// The registry imports every manifest; mock the AI layer so this test doesn't
// pull the server storage/env chain (matches how the action test is isolated).
jest.mock("@/lib/ai", () => ({
  generateText: jest.fn(),
  listAvailableModels: jest.fn(),
}));

import {
  getManifest,
  getServerActionById,
  getSupportedToolTypes,
} from "@/lib/tools/tool-registry";

describe("ai tool registration", () => {
  it("registers the ai manifest", () => {
    expect(getSupportedToolTypes()).toContain("ai");
    const manifest = getManifest("ai");
    expect(manifest?.type).toBe("ai");
    expect(manifest?.actions.map((a) => a.id)).toContain("ai-prompt");
  });

  it("resolves the ai-prompt action by its global id", () => {
    const action = getServerActionById("ai-prompt");
    expect(action).toBeDefined();
    expect(action?.producesOutput).toBe(true);
  });
});
