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

type AgentSettingsGetRequest = {
  cockpitId: string;
};

type AgentSettingsSaveRequest = {
  cockpitId: string;
  settings: AgentSettingsDocument;
};

function fail(message: string): never {
  throw new Error(`agent settings response invalid: ${message}`);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${path} must be object`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    fail(`${path} must be string`);
  }
  return value;
}

function asStringOrNull(value: unknown, path: string): string | null {
  if (value === null) {
    return null;
  }
  return asString(value, path);
}

function asStringList(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    fail(`${path} must be array`);
  }
  return value.map((entry, index) => asString(entry, `${path}[${index}]`));
}

function parseAgentSettingsDocument(payload: unknown): AgentSettingsDocument {
  const root = asRecord(payload, "root");
  const version = root.version;
  if (typeof version !== "number" || !Number.isFinite(version) || version <= 0) {
    fail("root.version must be positive number");
  }
  const agents = root.agents;
  if (!Array.isArray(agents)) {
    fail("root.agents must be array");
  }
  return {
    version: Math.floor(version),
    agents: agents.map((agent, index) => {
      const record = asRecord(agent, `root.agents[${index}]`);
      return {
        id: asString(record.id, `root.agents[${index}].id`),
        name: asString(record.name, `root.agents[${index}].name`),
        command: asString(record.command, `root.agents[${index}].command`),
        systemPrompt: asStringOrNull(
          record.systemPrompt,
          `root.agents[${index}].systemPrompt`,
        ),
        toolRestrictions: asStringList(
          record.toolRestrictions,
          `root.agents[${index}].toolRestrictions`,
        ),
      };
    }),
  };
}

export async function agentSettingsGet(req: AgentSettingsGetRequest): Promise<AgentSettingsDocument> {
  const payload = await invoke<unknown>("agent_settings_get", { req });
  return parseAgentSettingsDocument(payload);
}

export async function agentSettingsSave(req: AgentSettingsSaveRequest): Promise<AgentSettingsDocument> {
  const payload = await invoke<unknown>("agent_settings_save", { req });
  return parseAgentSettingsDocument(payload);
}
