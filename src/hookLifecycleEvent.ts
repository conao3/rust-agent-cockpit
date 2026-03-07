const hookLifecycleEventKinds = ["input_wait", "tool_running", "completed", "error"] as const;

type HookLifecycleEventKind = (typeof hookLifecycleEventKinds)[number];

type HookLifecycleEvent = {
  taskId: string;
  member: string;
  hookEvent: HookLifecycleEventKind;
  currentState: "sent" | "ack" | "in_progress" | "done" | "failed";
  source: string;
  eventKey: string;
  updatedAtMs: number;
  messageId: string | null;
  rawHookEvent: string | null;
};

function fail(message: string): never {
  throw new Error(`hook lifecycle event invalid: ${message}`);
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

function asNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${path} must be finite number`);
  }
  return value;
}

function asHookEventKind(value: unknown, path: string): HookLifecycleEventKind {
  const parsed = asString(value, path);
  if (
    parsed === "input_wait" ||
    parsed === "tool_running" ||
    parsed === "completed" ||
    parsed === "error"
  ) {
    return parsed;
  }
  fail(`${path} must be valid hook event kind`);
}

function asLifecycleState(value: unknown, path: string): HookLifecycleEvent["currentState"] {
  const parsed = asString(value, path);
  if (
    parsed === "sent" ||
    parsed === "ack" ||
    parsed === "in_progress" ||
    parsed === "done" ||
    parsed === "failed"
  ) {
    return parsed;
  }
  fail(`${path} must be valid lifecycle state`);
}

export function parseHookLifecycleEvent(payload: unknown): HookLifecycleEvent {
  const root = asRecord(payload, "root");
  return {
    taskId: asString(root.taskId, "root.taskId"),
    member: asString(root.member, "root.member"),
    hookEvent: asHookEventKind(root.hookEvent, "root.hookEvent"),
    currentState: asLifecycleState(root.currentState, "root.currentState"),
    source: asString(root.source, "root.source"),
    eventKey: asString(root.eventKey, "root.eventKey"),
    updatedAtMs: asNumber(root.updatedAtMs, "root.updatedAtMs"),
    messageId: asStringOrNull(root.messageId, "root.messageId"),
    rawHookEvent: asStringOrNull(root.rawHookEvent, "root.rawHookEvent"),
  };
}
