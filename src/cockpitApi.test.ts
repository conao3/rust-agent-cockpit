import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cockpitCreate,
  cockpitDelete,
  cockpitList,
  type CockpitDocument,
} from "./cockpitApi";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

afterEach(() => {
  invokeMock.mockReset();
});

describe("cockpitApi", () => {
  it("invokes cockpit_list with req wrapper", async () => {
    const payload: CockpitDocument[] = [
      {
        id: "con-103-main",
        title: "CON-103 cockpit",
        cwd: "/tmp/repo/.wt/con-103",
        taskId: "CON-103",
        member: "MemberA",
      },
    ];
    invokeMock.mockResolvedValueOnce(payload);

    const result = await cockpitList();

    expect(invokeMock).toHaveBeenCalledWith("cockpit_list", { req: {} });
    expect(result).toEqual(payload);
  });

  it("invokes cockpit_create with req wrapper", async () => {
    const cockpit: CockpitDocument = {
      id: "con-103-main",
      title: "CON-103 cockpit",
      cwd: "/tmp/repo/.wt/con-103",
      taskId: "CON-103",
      member: "MemberA",
    };
    invokeMock.mockResolvedValueOnce(cockpit);

    const result = await cockpitCreate({ cockpit });

    expect(invokeMock).toHaveBeenCalledWith("cockpit_create", { req: { cockpit } });
    expect(result).toEqual(cockpit);
  });

  it("invokes cockpit_delete with req wrapper", async () => {
    invokeMock.mockResolvedValueOnce({ id: "con-103-main", removed: true });

    const result = await cockpitDelete({ id: "con-103-main" });

    expect(invokeMock).toHaveBeenCalledWith("cockpit_delete", {
      req: { id: "con-103-main" },
    });
    expect(result.removed).toBe(true);
  });

  it("rejects malformed cockpit_list response", async () => {
    invokeMock.mockResolvedValueOnce([
      {
        id: "con-103-main",
        title: "CON-103 cockpit",
        cwd: "/tmp/repo/.wt/con-103",
        taskId: "CON-103",
        member: 1,
      },
    ]);

    await expect(cockpitList()).rejects.toThrow(
      "cockpit response invalid: root[0].member must be string",
    );
  });

  it("rejects malformed cockpit_delete response", async () => {
    invokeMock.mockResolvedValueOnce({ id: "con-103-main", removed: "yes" });

    await expect(cockpitDelete({ id: "con-103-main" })).rejects.toThrow(
      "cockpit response invalid: root.removed must be boolean",
    );
  });
});
