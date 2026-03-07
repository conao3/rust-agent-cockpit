import { invoke } from "@tauri-apps/api/core";

export type PtyId = string | number;

export type PtyCreateRequest = {
  cols: number;
  rows: number;
  cwd?: string;
  task_id?: string;
  member?: string;
};

export type PtyCreateResponse = {
  id: string;
};

export type PtyWriteRequest = {
  id: string;
  data: string;
};

export type PtyResizeRequest = {
  id: string;
  cols: number;
  rows: number;
};

export type PtyCloseRequest = {
  id: string;
};

export function ptyCreate(req: PtyCreateRequest): Promise<PtyCreateResponse> {
  return invoke<PtyCreateResponse>("pty_create", { req });
}

export function ptyWrite(req: PtyWriteRequest): Promise<void> {
  return invoke<void>("pty_write", { req });
}

export function ptyResize(req: PtyResizeRequest): Promise<void> {
  return invoke<void>("pty_resize", { req });
}

export function ptyClose(req: PtyCloseRequest): Promise<void> {
  return invoke<void>("pty_close", { req });
}
