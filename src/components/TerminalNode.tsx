import { useEffect, useRef } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "xterm";
import "xterm/css/xterm.css";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { PtyId } from "../ptyApi";
import { usePtyMutations } from "../hooks/usePtyMutations";

type PtyOutputPayload =
  | string
  | {
      id?: PtyId;
      ptyId?: PtyId;
      data?: string;
      output?: string;
    };

const normalizePtyId = (id: PtyId | null | undefined): string | null => {
  if (id === null || id === undefined) {
    return null;
  }
  return String(id);
};

export type TerminalNodeData = {
  label: string;
  cwd?: string;
  taskId?: string;
  member?: string;
};

const statusClassNames: Record<string, string> = {
  connecting: "text-blue-400",
  connected: "text-emerald-400",
  error: "text-red-400",
};

export function TerminalNode({ data }: NodeProps<TerminalNodeData>) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const statusRef = useRef("connecting");
  const { createPty, writePty, resizePty, closePty } = usePtyMutations();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      scrollback: 1000,
      fontFamily: "'Source Code Pro Variable', 'Source Code Pro', monospace",
      fontSize: 13,
      theme: {
        background: "#0a0a0a",
        foreground: "#e5e5e5",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    fitAddon.fit();
    terminal.focus();

    let detachEvent: UnlistenFn | undefined;
    const detachInput = terminal.onData((input) => {
      const id = ptyIdRef.current;
      if (!id) {
        return;
      }
      writePty({ id, data: input }).catch((error) => {
        terminal.writeln(`\r\n[pty_write error] ${String(error)}`);
      });
    });

    const sendResize = () => {
      const id = ptyIdRef.current;
      if (!id) {
        return;
      }
      resizePty({ id, cols: terminal.cols, rows: terminal.rows }).catch((error) => {
        terminal.writeln(`\r\n[pty_resize error] ${String(error)}`);
      });
    };

    const observer = new ResizeObserver(() => {
      fitAddon.fit();
      sendResize();
    });
    observer.observe(host);

    const bootstrap = async () => {
      try {
        const { id } = await createPty({
          cols: terminal.cols,
          rows: terminal.rows,
          cwd: data.cwd,
          task_id: data.taskId,
          member: data.member,
        });
        ptyIdRef.current = id;
        detachEvent = await listen<PtyOutputPayload>("pty-output", (event) => {
          const payload = event.payload;
          if (typeof payload === "string") {
            terminal.write(payload);
            return;
          }
          const eventId = normalizePtyId(payload.ptyId ?? payload.id);
          if (eventId && eventId !== ptyIdRef.current) {
            return;
          }
          const chunk = payload.data ?? payload.output;
          if (chunk) {
            terminal.write(chunk);
          }
        });
        statusRef.current = "connected";
      } catch (error) {
        statusRef.current = "error";
        terminal.writeln(`\r\n[pty_create/listen error] ${String(error)}`);
      }
    };

    bootstrap();

    return () => {
      observer.disconnect();
      detachInput.dispose();
      if (detachEvent) {
        detachEvent();
      }
      const id = ptyIdRef.current;
      if (id) {
        void closePty({ id });
      }
      terminal.dispose();
      ptyIdRef.current = null;
    };
  }, []);

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-slate-700 bg-[#0a0a0a] shadow-lg">
      <Handle type="target" position={Position.Top} className="!bg-slate-500" />
      <div className="flex items-center justify-between border-b border-slate-700 px-3 py-1.5">
        <span className="text-xs font-semibold text-slate-200">{data.label}</span>
        <span className={`text-[10px] ${statusClassNames[statusRef.current] ?? "text-slate-400"}`}>
          {statusRef.current}
        </span>
      </div>
      <div ref={hostRef} className="h-[300px] w-[600px]" />
      <Handle type="source" position={Position.Bottom} className="!bg-slate-500" />
    </div>
  );
}
