import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  linearIngestPollComments,
  linearIngestWebhookComment,
  parseLinearMessageIngestResponse,
} from "./linearInboxApi";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

afterEach(() => {
  invokeMock.mockReset();
});

describe("linearInboxApi", () => {
  it("ingests webhook comments through req wrapper", async () => {
    invokeMock.mockResolvedValueOnce({
      decision: "delivered",
      issueId: "CON-108",
      targetMember: "MemberA",
      normalizedBody: "@MemberA please continue",
      source: "webhook",
      ptyId: "pty-1",
      eventKey: "linear:comment:1",
    });

    const result = await linearIngestWebhookComment({
      issueId: "CON-108",
      body: "@MemberA please continue",
      targetMember: "MemberA",
      commentId: "lin_cmt_1",
      source: "linear-webhook",
    });

    expect(invokeMock).toHaveBeenCalledWith("linear_ingest_webhook_comment", {
      req: {
        issueId: "CON-108",
        body: "@MemberA please continue",
        targetMember: "MemberA",
        commentId: "lin_cmt_1",
        source: "linear-webhook",
      },
    });
    expect(result.decision).toBe("delivered");
    expect(result.ptyId).toBe("pty-1");
  });

  it("ingests polled comments through req wrapper", async () => {
    invokeMock.mockResolvedValueOnce([
      {
        decision: "duplicate",
        issueId: "CON-108",
        targetMember: "MemberA",
        normalizedBody: "same payload",
        source: "polling",
        ptyId: null,
        eventKey: "linear:comment:1",
      },
      {
        decision: "unroutable",
        issueId: "CON-108",
        targetMember: "MemberB",
        normalizedBody: "@MemberB check",
        source: "polling",
        ptyId: null,
        eventKey: "linear:comment:2",
      },
    ]);

    const result = await linearIngestPollComments([
      {
        issueId: "CON-108",
        body: "same payload",
        targetMember: "MemberA",
        commentId: "lin_cmt_1",
      },
      {
        issueId: "CON-108",
        body: "@MemberB check",
        targetMember: "MemberB",
        commentId: "lin_cmt_2",
      },
    ]);

    expect(invokeMock).toHaveBeenCalledWith("linear_ingest_poll_comments", {
      req: {
        comments: [
          {
            issueId: "CON-108",
            commentId: "lin_cmt_1",
            body: "same payload",
            targetMember: "MemberA",
            source: null,
          },
          {
            issueId: "CON-108",
            commentId: "lin_cmt_2",
            body: "@MemberB check",
            targetMember: "MemberB",
            source: null,
          },
        ],
      },
    });
    expect(result).toHaveLength(2);
    expect(result[0].decision).toBe("duplicate");
    expect(result[1].decision).toBe("unroutable");
  });

  it("parses linear ingest payload", () => {
    const parsed = parseLinearMessageIngestResponse({
      decision: "delivered",
      issueId: "CON-108",
      targetMember: "MemberA",
      normalizedBody: "normalized",
      source: "webhook",
      ptyId: "pty-1",
      eventKey: "linear:comment:1",
    });

    expect(parsed.issueId).toBe("CON-108");
    expect(parsed.targetMember).toBe("MemberA");
  });

  it("rejects malformed payload", () => {
    expect(() =>
      parseLinearMessageIngestResponse({
        decision: "invalid",
        issueId: "CON-108",
        targetMember: "MemberA",
        normalizedBody: "normalized",
        source: "webhook",
        ptyId: null,
        eventKey: "linear:comment:1",
      }),
    ).toThrow("linear inbox response invalid: root.decision must be valid linear message decision");
  });
});
