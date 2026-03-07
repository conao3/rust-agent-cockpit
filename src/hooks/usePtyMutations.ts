import { useMutation } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  ptyClose,
  ptyCreate,
  ptyResize,
  ptyWrite,
  type PtyCloseRequest,
  type PtyCreateRequest,
  type PtyCreateResponse,
  type PtyResizeRequest,
  type PtyWriteRequest,
} from "../ptyApi";

export function usePtyMutations() {
  const createMutation = useMutation({
    mutationKey: ["pty", "create"],
    mutationFn: (req: PtyCreateRequest) => ptyCreate(req),
  });

  const writeMutation = useMutation({
    mutationKey: ["pty", "write"],
    mutationFn: (req: PtyWriteRequest) => ptyWrite(req),
  });

  const resizeMutation = useMutation({
    mutationKey: ["pty", "resize"],
    mutationFn: (req: PtyResizeRequest) => ptyResize(req),
  });

  const closeMutation = useMutation({
    mutationKey: ["pty", "close"],
    mutationFn: (req: PtyCloseRequest) => ptyClose(req),
  });

  const createPty = useCallback(
    (req: PtyCreateRequest): Promise<PtyCreateResponse> => createMutation.mutateAsync(req),
    [createMutation],
  );
  const writePty = useCallback(
    (req: PtyWriteRequest): Promise<void> => writeMutation.mutateAsync(req),
    [writeMutation],
  );
  const resizePty = useCallback(
    (req: PtyResizeRequest): Promise<void> => resizeMutation.mutateAsync(req),
    [resizeMutation],
  );
  const closePty = useCallback(
    (req: PtyCloseRequest): Promise<void> => closeMutation.mutateAsync(req),
    [closeMutation],
  );

  return {
    createPty,
    writePty,
    resizePty,
    closePty,
  };
}
