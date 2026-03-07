import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  worktreeCreate,
  worktreeDelete,
  worktreeList,
  type WorktreeListItem,
} from "./worktreeApi";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

afterEach(() => {
  invokeMock.mockReset();
});

describe("worktreeApi", () => {
  it("invokes worktree_create with req wrapper", async () => {
    invokeMock.mockResolvedValueOnce({
      branch: "feature/con-71",
      worktreeDir: "/tmp/repo/.wt/feature-con-71",
      title: "feature/con-71",
      created: true,
      exists: true,
      opened: false,
    });

    const result = await worktreeCreate({
      branch: "feature/con-71",
      basedir: ".wt",
      copyignored: true,
    });

    expect(invokeMock).toHaveBeenCalledWith("worktree_create", {
      req: { branch: "feature/con-71", basedir: ".wt", copyignored: true },
    });
    expect(result.created).toBe(true);
  });

  it("invokes worktree_delete with req wrapper", async () => {
    invokeMock.mockResolvedValueOnce({
      branch: "feature/con-71",
      worktreeDir: "/tmp/repo/.wt/feature-con-71",
      title: "feature/con-71",
      removed: true,
    });

    const result = await worktreeDelete({
      branch: "feature/con-71",
      basedir: ".wt",
      force: true,
    });

    expect(invokeMock).toHaveBeenCalledWith("worktree_delete", {
      req: { branch: "feature/con-71", basedir: ".wt", force: true },
    });
    expect(result.removed).toBe(true);
  });

  it("invokes worktree_list and propagates backend failures", async () => {
    const rows: WorktreeListItem[] = [
      {
        branch: "feature/con-71",
        worktreeDir: "/tmp/repo/.wt/feature-con-71",
        title: "feature/con-71",
        opened: true,
        exists: true,
      },
    ];
    invokeMock.mockResolvedValueOnce(rows);

    const listed = await worktreeList({ basedir: ".wt" });
    expect(invokeMock).toHaveBeenCalledWith("worktree_list", {
      req: { basedir: ".wt" },
    });
    expect(listed).toEqual(rows);

    invokeMock.mockRejectedValueOnce(new Error("basedir must not be empty"));
    await expect(worktreeList({ basedir: "" })).rejects.toThrow(
      "basedir must not be empty",
    );
  });
});
