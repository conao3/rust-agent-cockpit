import { invoke } from "@tauri-apps/api/core";

export type AgentSettings = {
  id: string;
  name: string;
  command: string;
  systemPrompt: string | null;
  toolRestrictions: string[];
};

export type AgentSettingsDocument = {
  version: number;
  agents: AgentSettings[];
};

export type AgentSettingsSaveRequest = {
  settings: AgentSettingsDocument;
};

export function agentSettingsGet(): Promise<AgentSettingsDocument> {
  return invoke<AgentSettingsDocument>("agent_settings_get", { req: {} });
}

export function agentSettingsSave(req: AgentSettingsSaveRequest): Promise<AgentSettingsDocument> {
  return invoke<AgentSettingsDocument>("agent_settings_save", { req });
}
