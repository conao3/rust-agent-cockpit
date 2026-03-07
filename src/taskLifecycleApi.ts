import { invoke } from "@tauri-apps/api/core";

export const lifecycleStates = ["sent", "ack", "in_progress", "done", "failed"] as const;

export type LifecycleState = (typeof lifecycleStates)[number];
type LifecycleDecision = "applied" | "duplicate" | "stale";

type TaskRegistrationRequest = {
  taskId: string;
  member: string;
  title?: string;
  dedupeKey?: string;
};

type TaskLifecycleTransitionRequest = {
  taskId: string;
  member: string;
  state: LifecycleState;
  messageId?: string;
  dedupeKey?: string;
  source?: string;
};

type TaskLifecycleLookupRequest = {
  taskId: string;
  member: string;
};

type LifecycleStateQueryRequest = {
  taskId: string;
  member: string;
};

export type TaskLifecycleSnapshot = {
  taskId: string;
  member: string;
  title: string | null;
  dedupeKey: string | null;
  state: LifecycleState | null;
  lastEventId: string | null;
  updatedAtMs: number | null;
  historyLen: number;
};

type LifecycleStateResponse = {
  taskId: string;
  member: string;
  state: LifecycleState;
  lastEventId: string | null;
  updatedAtMs: number;
  historyLen: number;
};

type LifecycleIngestResponse = {
  decision: LifecycleDecision;
  taskId: string;
  member: string;
  currentState: LifecycleState;
  eventKey: string;
  updatedAtMs: number;
};

function fail(message: string): never {
  throw new Error(`task lifecycle response invalid: ${message}`);
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

function asOptionalNumber(value: unknown, path: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return asNumber(value, path);
}

function asNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${path} must be finite number`);
  }
  return value;
}

function asDecision(value: unknown, path: string): LifecycleDecision {
  const raw = asString(value, path);
  if (raw === "applied" || raw === "duplicate" || raw === "stale") {
    return raw;
  }
  fail(`${path} must be valid lifecycle decision`);
}

function asState(value: unknown, path: string): LifecycleState {
  const raw = asString(value, path);
  if (raw === "sent" || raw === "ack" || raw === "in_progress" || raw === "done" || raw === "failed") {
    return raw;
  }
  fail(`${path} must be valid lifecycle state`);
}

function asOptionalState(value: unknown, path: string): LifecycleState | null {
  if (value === null || value === undefined) {
    return null;
  }
  return asState(value, path);
}

function asHistoryLen(value: unknown, path: string): number {
  const parsed = asNumber(value, path);
  if (!Number.isInteger(parsed) || parsed < 0) {
    fail(`${path} must be non-negative integer`);
  }
  return parsed;
}

function parseSnapshot(payload: unknown): TaskLifecycleSnapshot {
  const root = asRecord(payload, "root");
  return {
    taskId: asString(root.taskId, "root.taskId"),
    member: asString(root.member, "root.member"),
    title: asStringOrNull(root.title, "root.title"),
    dedupeKey: asStringOrNull(root.dedupeKey, "root.dedupeKey"),
    state: asOptionalState(root.state, "root.state"),
    lastEventId: asStringOrNull(root.lastEventId, "root.lastEventId"),
    updatedAtMs: asOptionalNumber(root.updatedAtMs, "root.updatedAtMs"),
    historyLen: asHistoryLen(root.historyLen, "root.historyLen"),
  };
}

function parseLifecycleState(payload: unknown): LifecycleStateResponse {
  const root = asRecord(payload, "root");
  return {
    taskId: asString(root.taskId, "root.taskId"),
    member: asString(root.member, "root.member"),
    state: asState(root.state, "root.state"),
    lastEventId: asStringOrNull(root.lastEventId, "root.lastEventId"),
    updatedAtMs: asNumber(root.updatedAtMs, "root.updatedAtMs"),
    historyLen: asHistoryLen(root.historyLen, "root.historyLen"),
  };
}

export function parseLifecycleIngestResponse(payload: unknown): LifecycleIngestResponse {
  const root = asRecord(payload, "root");
  return {
    decision: asDecision(root.decision, "root.decision"),
    taskId: asString(root.taskId, "root.taskId"),
    member: asString(root.member, "root.member"),
    currentState: asState(root.currentState, "root.currentState"),
    eventKey: asString(root.eventKey, "root.eventKey"),
    updatedAtMs: asNumber(root.updatedAtMs, "root.updatedAtMs"),
  };
}

export async function taskRegisterDefinition(req: TaskRegistrationRequest): Promise<TaskLifecycleSnapshot> {
  const payload = await invoke<unknown>("task_register_definition", {
    req: {
      taskId: req.taskId,
      member: req.member,
      title: req.title ?? null,
      dedupeKey: req.dedupeKey ?? null,
    },
  });
  return parseSnapshot(payload);
}

export async function taskTransitionLifecycle(req: TaskLifecycleTransitionRequest): Promise<TaskLifecycleSnapshot> {
  const payload = await invoke<unknown>("task_transition_lifecycle", {
    req: {
      taskId: req.taskId,
      member: req.member,
      state: req.state,
      messageId: req.messageId ?? null,
      dedupeKey: req.dedupeKey ?? null,
      source: req.source ?? null,
    },
  });
  return parseSnapshot(payload);
}

export async function taskGetLifecycle(req: TaskLifecycleLookupRequest): Promise<TaskLifecycleSnapshot> {
  const payload = await invoke<unknown>("task_get_lifecycle", {
    req: {
      taskId: req.taskId,
      member: req.member,
    },
  });
  return parseSnapshot(payload);
}

export async function monitoringGetLifecycleState(
  req: LifecycleStateQueryRequest,
): Promise<LifecycleStateResponse | null> {
  const payload = await invoke<unknown>("monitoring_get_lifecycle_state", {
    req: {
      taskId: req.taskId,
      member: req.member,
    },
  });
  if (payload === null) {
    return null;
  }
  return parseLifecycleState(payload);
}
