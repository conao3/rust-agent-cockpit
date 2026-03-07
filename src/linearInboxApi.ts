import { invoke } from "@tauri-apps/api/core";

export type LinearMessageDecision = "delivered" | "duplicate" | "unroutable";

type LinearCommentEnvelope = {
  issueId: string;
  commentId?: string;
  body: string;
  targetMember?: string;
  source?: string;
};

export type LinearMessageIngestResponse = {
  decision: LinearMessageDecision;
  issueId: string;
  targetMember: string;
  normalizedBody: string;
  source: string;
  ptyId: string | null;
  eventKey: string;
};

function fail(message: string): never {
  throw new Error(`linear inbox response invalid: ${message}`);
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

function asDecision(value: unknown, path: string): LinearMessageDecision {
  const raw = asString(value, path);
  if (raw === "delivered" || raw === "duplicate" || raw === "unroutable") {
    return raw;
  }
  fail(`${path} must be valid linear message decision`);
}

export function parseLinearMessageIngestResponse(payload: unknown): LinearMessageIngestResponse {
  const root = asRecord(payload, "root");
  return {
    decision: asDecision(root.decision, "root.decision"),
    issueId: asString(root.issueId, "root.issueId"),
    targetMember: asString(root.targetMember, "root.targetMember"),
    normalizedBody: asString(root.normalizedBody, "root.normalizedBody"),
    source: asString(root.source, "root.source"),
    ptyId: asStringOrNull(root.ptyId, "root.ptyId"),
    eventKey: asString(root.eventKey, "root.eventKey"),
  };
}

function toReq(comment: LinearCommentEnvelope) {
  return {
    issueId: comment.issueId,
    commentId: comment.commentId ?? null,
    body: comment.body,
    targetMember: comment.targetMember ?? null,
    source: comment.source ?? null,
  };
}

export async function linearIngestWebhookComment(
  req: LinearCommentEnvelope,
): Promise<LinearMessageIngestResponse> {
  const payload = await invoke<unknown>("linear_ingest_webhook_comment", {
    req: toReq(req),
  });
  return parseLinearMessageIngestResponse(payload);
}

export async function linearIngestPollComments(
  comments: LinearCommentEnvelope[],
): Promise<LinearMessageIngestResponse[]> {
  const payload = await invoke<unknown>("linear_ingest_poll_comments", {
    req: {
      comments: comments.map(toReq),
    },
  });
  if (!Array.isArray(payload)) {
    fail("root must be array");
  }
  return payload.map((entry, index) => parseLinearMessageIngestResponse(asRecord(entry, `root[${index}]`)));
}
