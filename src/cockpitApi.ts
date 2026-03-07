import { invoke } from "@tauri-apps/api/core";

export type CockpitDocument = {
  id: string;
  title: string;
  cwd: string;
  taskId: string | null;
  member: string | null;
};

export type CockpitCreateRequest = {
  cockpit: CockpitDocument;
};

export type CockpitDeleteRequest = {
  id: string;
};

export type CockpitDeleteResponse = {
  id: string;
  removed: boolean;
};

function fail(message: string): never {
  throw new Error(`cockpit response invalid: ${message}`);
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

function asNullableString(value: unknown, path: string): string | null {
  if (value === null) {
    return null;
  }
  return asString(value, path);
}

function asBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    fail(`${path} must be boolean`);
  }
  return value;
}

function parseCockpit(payload: unknown, path = "root"): CockpitDocument {
  const record = asRecord(payload, path);
  return {
    id: asString(record.id, `${path}.id`),
    title: asString(record.title, `${path}.title`),
    cwd: asString(record.cwd, `${path}.cwd`),
    taskId: asNullableString(record.taskId, `${path}.taskId`),
    member: asNullableString(record.member, `${path}.member`),
  };
}

function parseCockpitList(payload: unknown): CockpitDocument[] {
  if (!Array.isArray(payload)) {
    fail("root must be array");
  }
  return payload.map((entry, index) => parseCockpit(entry, `root[${index}]`));
}

function parseDelete(payload: unknown): CockpitDeleteResponse {
  const record = asRecord(payload, "root");
  return {
    id: asString(record.id, "root.id"),
    removed: asBoolean(record.removed, "root.removed"),
  };
}

export async function cockpitList(): Promise<CockpitDocument[]> {
  const payload = await invoke<unknown>("cockpit_list", { req: {} });
  return parseCockpitList(payload);
}

export async function cockpitCreate(req: CockpitCreateRequest): Promise<CockpitDocument> {
  const payload = await invoke<unknown>("cockpit_create", { req });
  return parseCockpit(payload);
}

export async function cockpitDelete(req: CockpitDeleteRequest): Promise<CockpitDeleteResponse> {
  const payload = await invoke<unknown>("cockpit_delete", { req });
  return parseDelete(payload);
}
