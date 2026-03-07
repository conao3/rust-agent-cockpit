import { describe, expect, it } from "vitest";
import { parseHookLifecycleEvent } from "./hookLifecycleEvent";

describe("hookLifecycleEvent", () => {
  it("parses monitoring-hook payload", () => {
    const parsed = parseHookLifecycleEvent({
      taskId: "CON-83",
      member: "MemberB",
      hookEvent: "tool_running",
      currentState: "in_progress",
      source: "claude_hook",
      eventKey: "logs/codex/CON-83/20260307.jsonl:42",
      updatedAtMs: 123,
      messageId: "evt-1",
      rawHookEvent: "PreToolUse",
    });

    expect(parsed.hookEvent).toBe("tool_running");
    expect(parsed.currentState).toBe("in_progress");
  });

  it("rejects malformed hook event", () => {
    expect(() =>
      parseHookLifecycleEvent({
        taskId: "CON-83",
        member: "MemberB",
        hookEvent: "queued",
        currentState: "in_progress",
        source: "claude_hook",
        eventKey: "k",
        updatedAtMs: 1,
        messageId: null,
        rawHookEvent: null,
      }),
    ).toThrow("hook lifecycle event invalid: root.hookEvent must be valid hook event kind");
  });
});
