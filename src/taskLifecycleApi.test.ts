import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  monitoringGetLifecycleState,
  parseLifecycleIngestResponse,
  taskGetLifecycle,
  taskRegisterDefinition,
  taskTransitionLifecycle,
} from "./taskLifecycleApi";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

afterEach(() => {
  invokeMock.mockReset();
});

describe("taskLifecycleApi", () => {
  it("registers definition through req wrapper", async () => {
    invokeMock.mockResolvedValueOnce({
      taskId: "CON-107",
      member: "MemberB",
      title: "Task Lifecycle Monitor",
      dedupeKey: null,
      state: null,
      lastEventId: null,
      updatedAtMs: null,
      historyLen: 0,
    });

    const result = await taskRegisterDefinition({
      taskId: "CON-107",
      member: "MemberB",
      title: "Task Lifecycle Monitor",
    });

    expect(invokeMock).toHaveBeenCalledWith("task_register_definition", {
      req: {
        taskId: "CON-107",
        member: "MemberB",
        title: "Task Lifecycle Monitor",
        dedupeKey: null,
      },
    });
    expect(result.taskId).toBe("CON-107");
  });

  it("transitions lifecycle through req wrapper", async () => {
    invokeMock.mockResolvedValueOnce({
      taskId: "CON-107",
      member: "MemberB",
      title: "Task Lifecycle Monitor",
      dedupeKey: null,
      state: "in_progress",
      lastEventId: "event-1",
      updatedAtMs: 10,
      historyLen: 2,
    });

    const result = await taskTransitionLifecycle({
      taskId: "CON-107",
      member: "MemberB",
      state: "in_progress",
      source: "ui",
    });

    expect(invokeMock).toHaveBeenCalledWith("task_transition_lifecycle", {
      req: {
        taskId: "CON-107",
        member: "MemberB",
        state: "in_progress",
        messageId: null,
        dedupeKey: null,
        source: "ui",
      },
    });
    expect(result.state).toBe("in_progress");
  });

  it("gets lifecycle snapshot through req wrapper", async () => {
    invokeMock.mockResolvedValueOnce({
      taskId: "CON-107",
      member: "MemberB",
      title: "Task Lifecycle Monitor",
      dedupeKey: null,
      state: "ack",
      lastEventId: "event-1",
      updatedAtMs: 10,
      historyLen: 3,
    });

    const result = await taskGetLifecycle({
      taskId: "CON-107",
      member: "MemberB",
    });

    expect(invokeMock).toHaveBeenCalledWith("task_get_lifecycle", {
      req: {
        taskId: "CON-107",
        member: "MemberB",
      },
    });
    expect(result.state).toBe("ack");
  });

  it("handles monitoring_get_lifecycle_state nullable response", async () => {
    invokeMock.mockResolvedValueOnce(null);
    const missing = await monitoringGetLifecycleState({
      taskId: "CON-999",
      member: "MemberZ",
    });
    expect(missing).toBeNull();

    invokeMock.mockResolvedValueOnce({
      taskId: "CON-107",
      member: "MemberB",
      state: "sent",
      lastEventId: null,
      updatedAtMs: 123,
      historyLen: 1,
    });
    const result = await monitoringGetLifecycleState({
      taskId: "CON-107",
      member: "MemberB",
    });
    expect(result?.state).toBe("sent");
  });

  it("parses monitoring lifecycle event payload", () => {
    const parsed = parseLifecycleIngestResponse({
      decision: "applied",
      taskId: "CON-107",
      member: "MemberB",
      currentState: "in_progress",
      eventKey: "task:event",
      updatedAtMs: 100,
    });
    expect(parsed.currentState).toBe("in_progress");
  });

  it("rejects malformed snapshot payload", async () => {
    invokeMock.mockResolvedValueOnce({
      taskId: "CON-107",
      member: "MemberB",
      title: null,
      dedupeKey: null,
      state: "reviewing",
      lastEventId: null,
      updatedAtMs: null,
      historyLen: 0,
    });
    await expect(
      taskGetLifecycle({
        taskId: "CON-107",
        member: "MemberB",
      }),
    ).rejects.toThrow("task lifecycle response invalid: root.state must be valid lifecycle state");
  });
});
