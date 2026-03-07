import { invoke } from "@tauri-apps/api/core";

export type WorktreeCreateRequest = {
  branch: string;
  basedir: string;
  hook?: string;
  deletehook?: string;
  copyignored?: boolean;
};

export type WorktreeDeleteRequest = {
  branch: string;
  basedir: string;
  deletehook?: string;
  force?: boolean;
};

export type WorktreeListRequest = {
  basedir: string;
};

export type WorktreeLifecycleResponse = {
  branch: string;
  worktreeDir: string;
  title: string;
  created: boolean;
  exists: boolean;
  opened: boolean;
};

export type WorktreeDeleteResponse = {
  branch: string;
  worktreeDir: string;
  title: string;
  removed: boolean;
};

export type WorktreeListItem = {
  branch: string;
  worktreeDir: string;
  title: string;
  opened: boolean;
  exists: boolean;
};

export function worktreeCreate(req: WorktreeCreateRequest): Promise<WorktreeLifecycleResponse> {
  return invoke<WorktreeLifecycleResponse>("worktree_create", { req });
}

export function worktreeDelete(req: WorktreeDeleteRequest): Promise<WorktreeDeleteResponse> {
  return invoke<WorktreeDeleteResponse>("worktree_delete", { req });
}

export function worktreeList(req: WorktreeListRequest): Promise<WorktreeListItem[]> {
  return invoke<WorktreeListItem[]>("worktree_list", { req });
}
