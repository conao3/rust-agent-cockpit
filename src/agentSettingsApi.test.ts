import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentSettingsGet, agentSettingsSave, type AgentSettingsDocument } from "./agentSettingsApi";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

afterEach(() => {
  invokeMock.mockReset();
});

describe("agentSettingsApi", () => {
  it("invokes agent_settings_get with req wrapper", async () => {
    const payload: AgentSettingsDocument = {
      version: 1,
      agents: [],
    };
    invokeMock.mockResolvedValueOnce(payload);

    const result = await agentSettingsGet();

    expect(invokeMock).toHaveBeenCalledWith("agent_settings_get", { req: {} });
    expect(result).toEqual(payload);
  });

  it("invokes agent_settings_save with req wrapper", async () => {
    const settings: AgentSettingsDocument = {
      version: 1,
      agents: [
        {
          id: "leader",
          name: "Leader",
          command: "codex",
          systemPrompt: "coordinate",
          toolRestrictions: ["git", "cargo"],
        },
      ],
    };
    invokeMock.mockResolvedValueOnce(settings);

    const result = await agentSettingsSave({ settings });

    expect(invokeMock).toHaveBeenCalledWith("agent_settings_save", {
      req: { settings },
    });
    expect(result).toEqual(settings);
  });
});
