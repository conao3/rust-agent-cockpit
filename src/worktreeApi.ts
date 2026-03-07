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

export type WorktreeOpenRequest = {
  branch: string;
  basedir: string;
  hook?: string;
  deletehook?: string;
  copyignored?: boolean;
};

export type WorktreeCloseRequest = {
  branch: string;
  basedir: string;
  deleteOnClose?: boolean;
  force?: boolean;
};

export type WorktreeListRequest = {
  basedir: string;
};

export type WorktreeTitleInfoRequest = {
  branch: string;
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

export type WorktreeCloseResponse = {
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

function fail(message: string): never {
  throw new Error(`worktree response invalid: ${message}`);
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

function asBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    fail(`${path} must be boolean`);
  }
  return value;
}

function parseLifecycle(payload: unknown): WorktreeLifecycleResponse {
  const record = asRecord(payload, "root");
  return {
    branch: asString(record.branch, "root.branch"),
    worktreeDir: asString(record.worktreeDir, "root.worktreeDir"),
    title: asString(record.title, "root.title"),
    created: asBoolean(record.created, "root.created"),
    exists: asBoolean(record.exists, "root.exists"),
    opened: asBoolean(record.opened, "root.opened"),
  };
}

function parseDelete(payload: unknown): WorktreeDeleteResponse {
  const record = asRecord(payload, "root");
  return {
    branch: asString(record.branch, "root.branch"),
    worktreeDir: asString(record.worktreeDir, "root.worktreeDir"),
    title: asString(record.title, "root.title"),
    removed: asBoolean(record.removed, "root.removed"),
  };
}

function parseList(payload: unknown): WorktreeListItem[] {
  if (!Array.isArray(payload)) {
    fail("root must be array");
  }
  return payload.map((entry, index) => {
    const record = asRecord(entry, `root[${index}]`);
    return {
      branch: asString(record.branch, `root[${index}].branch`),
      worktreeDir: asString(record.worktreeDir, `root[${index}].worktreeDir`),
      title: asString(record.title, `root[${index}].title`),
      opened: asBoolean(record.opened, `root[${index}].opened`),
      exists: asBoolean(record.exists, `root[${index}].exists`),
    };
  });
}

export async function worktreeCreate(req: WorktreeCreateRequest): Promise<WorktreeLifecycleResponse> {
  const payload = await invoke<unknown>("worktree_create", { req });
  return parseLifecycle(payload);
}

export async function worktreeDelete(req: WorktreeDeleteRequest): Promise<WorktreeDeleteResponse> {
  const payload = await invoke<unknown>("worktree_delete", { req });
  return parseDelete(payload);
}

export async function worktreeOpen(req: WorktreeOpenRequest): Promise<WorktreeLifecycleResponse> {
  const payload = await invoke<unknown>("worktree_open", { req });
  return parseLifecycle(payload);
}

export async function worktreeClose(req: WorktreeCloseRequest): Promise<WorktreeCloseResponse> {
  const payload = await invoke<unknown>("worktree_close", { req });
  return parseDelete(payload);
}

export async function worktreeList(req: WorktreeListRequest): Promise<WorktreeListItem[]> {
  const payload = await invoke<unknown>("worktree_list", { req });
  return parseList(payload);
}

export async function worktreeTitleInfo(req: WorktreeTitleInfoRequest): Promise<WorktreeLifecycleResponse> {
  const payload = await invoke<unknown>("worktree_title_info", { req });
  return parseLifecycle(payload);
}
