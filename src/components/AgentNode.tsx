import { useEffect, useRef } from "react";
import { Handle, Position, type NodeProps, useReactFlow } from "reactflow";
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

function normalizePtyId(id: PtyId | null | undefined): string | null {
  if (id === null || id === undefined) {
    return null;
  }
  return String(id);
}

export type AgentNodeData = {
  label: string;
  role: "leader" | "member";
  status: "online" | "idle" | "error";
  expanded?: boolean;
  cwd?: string;
  taskId?: string;
  member?: string;
};

const statusColors = {
  online: "bg-emerald-400",
  idle: "bg-slate-500",
  error: "bg-red-400",
} as const;

const roleBorderColors = {
  leader: "border-emerald-500",
  member: "border-slate-600",
} as const;

function EmbeddedTerminal({ cwd, taskId, member }: { cwd?: string; taskId?: string; member?: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const ptyIdRef = useRef<string | null>(null);
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
          cwd,
          task_id: taskId,
          member,
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
      } catch (error) {
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

  return <div ref={hostRef} className="nodrag nowheel nopan h-[300px] w-[600px]" />;
}

export function AgentNode({ id, data }: NodeProps<AgentNodeData>) {
  const { setNodes } = useReactFlow();

  const toggle = () => {
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? {
              ...node,
              dragHandle: node.data.expanded ? undefined : ".agent-drag-handle",
              data: { ...node.data, expanded: !node.data.expanded },
            }
          : node,
      ),
    );
  };

  if (data.expanded) {
    return (
      <div className={`flex flex-col overflow-hidden rounded-lg border ${roleBorderColors[data.role]} bg-[#0a0a0a] shadow-lg`}>
        <Handle type="target" position={Position.Top} className="!bg-slate-500" />
        <div
          className="agent-drag-handle flex cursor-grab items-center justify-between border-b border-slate-700 px-3 py-1.5"
          onClick={toggle}
        >
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${statusColors[data.status]}`} />
            <span className="text-xs font-semibold text-slate-200">{data.label}</span>
            <span className="text-[10px] text-slate-500">{data.role}</span>
          </div>
          <span className="text-[10px] text-slate-400">click to collapse</span>
        </div>
        <EmbeddedTerminal cwd={data.cwd} taskId={data.taskId} member={data.member} />
        <Handle type="source" position={Position.Bottom} className="!bg-slate-500" />
      </div>
    );
  }

  return (
    <div
      className={`cursor-pointer rounded-lg border ${roleBorderColors[data.role]} bg-slate-950/90 px-4 py-3 shadow-lg`}
      onClick={toggle}
    >
      <Handle type="target" position={Position.Top} className="!bg-slate-500" />
      <div className="flex items-center gap-2">
        <div className={`h-2 w-2 rounded-full ${statusColors[data.status]}`} />
        <span className="text-sm font-semibold text-slate-100">{data.label}</span>
      </div>
      <div className="mt-0.5 text-[11px] text-slate-400">{data.role}</div>
      <Handle type="source" position={Position.Bottom} className="!bg-slate-500" />
    </div>
  );
}
