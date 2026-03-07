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

  it("rejects malformed get response payload", async () => {
    invokeMock.mockResolvedValueOnce({
      version: 1,
      agents: [{ id: "leader", name: "Leader", command: "codex", systemPrompt: null }],
    });

    await expect(agentSettingsGet()).rejects.toThrow(
      "agent settings response invalid: root.agents[0].toolRestrictions must be array",
    );
  });

  it("rejects malformed save response payload", async () => {
    const settings: AgentSettingsDocument = { version: 1, agents: [] };
    invokeMock.mockResolvedValueOnce({
      version: "1",
      agents: [],
    });

    await expect(agentSettingsSave({ settings })).rejects.toThrow(
      "agent settings response invalid: root.version must be positive number",
    );
  });
});
