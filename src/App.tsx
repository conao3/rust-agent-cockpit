import { useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "xterm";
import "xterm/css/xterm.css";
import { ConnectionManager } from "./components/ConnectionManager";
import { usePtyMutations } from "./hooks/usePtyMutations";
import type { PtyId } from "./ptyApi";
import { Window } from "./components/Window";

type PtyCreateContext = {
  cwd?: string;
  taskId?: string;
  member?: string;
};

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

const graphNodes = [
  { id: "leader", label: "Leader" },
  { id: "member-a", label: "Member A" },
  { id: "member-b", label: "Member B" },
] as const;

const firstNonEmpty = (...values: Array<string | null>): string | undefined => {
  for (const value of values) {
    if (value) {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return undefined;
};

export const resolvePtyCreateContext = (search: string): PtyCreateContext => {
  const params = new URLSearchParams(search);
  const taskId = firstNonEmpty(params.get("pty"), params.get("task_id"), params.get("taskId"));
  const member = firstNonEmpty(params.get("agent"), params.get("member"));
  const cwd = firstNonEmpty(params.get("cwd"));
  return {
    cwd,
    taskId,
    member,
  };
};

type WindowId = "connections" | "terminal";

type ManagedWindow = {
  id: WindowId;
  title: string;
  status?: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

const MIN_WINDOW_WIDTH = 300;
const MIN_WINDOW_HEIGHT = 220;

const initialWindows: ManagedWindow[] = [
  {
    id: "connections",
    title: "Connections",
    status: "connected",
    x: 16,
    y: 16,
    width: 420,
    height: 380,
  },
  {
    id: "terminal",
    title: "PTY Terminal",
    status: "connecting",
    x: 220,
    y: 120,
    width: 760,
    height: 440,
  },
];

function App() {
  const desktopRef = useRef<HTMLDivElement | null>(null);
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const { createPty, writePty, resizePty, closePty } = usePtyMutations();
  const [status, setStatus] = useState("connecting");
  const [windows, setWindows] = useState<ManagedWindow[]>(initialWindows);
  const [zOrder, setZOrder] = useState<WindowId[]>(["connections", "terminal"]);

  const updateWindow = (id: WindowId, updater: (window: ManagedWindow) => ManagedWindow) => {
    setWindows((current) => current.map((window) => (window.id === id ? updater(window) : window)));
  };

  const activateWindow = (id: WindowId) => {
    setZOrder((current) => [...current.filter((entry) => entry !== id), id]);
  };

  const moveWindow = (id: WindowId, nextX: number, nextY: number) => {
    const desktop = desktopRef.current;
    const bounds = desktop?.getBoundingClientRect();

    updateWindow(id, (window) => {
      if (!bounds) {
        return {
          ...window,
          x: Math.max(0, nextX),
          y: Math.max(0, nextY),
        };
      }

      const maxX = Math.max(0, bounds.width - 140);
      const maxY = Math.max(0, bounds.height - 40);
      return {
        ...window,
        x: Math.min(Math.max(0, nextX), maxX),
        y: Math.min(Math.max(0, nextY), maxY),
      };
    });
  };

  const resizeWindow = (id: WindowId, nextWidth: number, nextHeight: number) => {
    const desktop = desktopRef.current;
    const bounds = desktop?.getBoundingClientRect();

    updateWindow(id, (window) => {
      const maxWidth = bounds
        ? Math.max(MIN_WINDOW_WIDTH, bounds.width - window.x)
        : Number.POSITIVE_INFINITY;
      const maxHeight = bounds
        ? Math.max(MIN_WINDOW_HEIGHT, bounds.height - window.y)
        : Number.POSITIVE_INFINITY;

      return {
        ...window,
        width: Math.min(Math.max(MIN_WINDOW_WIDTH, nextWidth), maxWidth),
        height: Math.min(Math.max(MIN_WINDOW_HEIGHT, nextHeight), maxHeight),
      };
    });
  };

  useEffect(() => {
    updateWindow("terminal", (window) => ({
      ...window,
      status,
    }));
  }, [status]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "r"
      ) {
        event.preventDefault();
        window.location.reload();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    const host = terminalHostRef.current;
    if (!host) {
      return;
    }

    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      scrollback: 1000,
      fontFamily: "'Source Code Pro Variable', 'Source Code Pro', monospace",
      fontSize: 14,
      theme: {
        background: "#111827",
        foreground: "#e5e7eb",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    fitAddon.fit();
    terminal.focus();

    let detachEvent: UnlistenFn | undefined;
    const detachInput = terminal.onData((data) => {
      const id = ptyIdRef.current;
      if (!id) {
        return;
      }
      writePty({ id, data }).catch((error) => {
        terminal.writeln(`\r\n[pty_write error] ${String(error)}`);
      });
    });

    const sendResize = () => {
      const id = ptyIdRef.current;
      if (!id) {
        return;
      }
      resizePty({
        id,
        cols: terminal.cols,
        rows: terminal.rows,
      }).catch((error) => {
        terminal.writeln(`\r\n[pty_resize error] ${String(error)}`);
      });
    };

    const onResize = () => {
      fitAddon.fit();
      sendResize();
    };
    window.addEventListener("resize", onResize);

    const bootstrap = async () => {
      try {
        const context = resolvePtyCreateContext(window.location.search);
        const { id } = await createPty({
          cols: terminal.cols,
          rows: terminal.rows,
          cwd: context.cwd,
          task_id: context.taskId,
          member: context.member,
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

        setStatus("connected");
      } catch (error) {
        setStatus("error");
        terminal.writeln(`\r\n[pty_create/listen error] ${String(error)}`);
      }
    };

    bootstrap();

    return () => {
      window.removeEventListener("resize", onResize);
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
    <main className="box-border h-full w-full p-2.5 md:p-0">
      <div
        ref={desktopRef}
        className="relative h-full w-full overflow-hidden rounded-xl bg-[radial-gradient(circle_at_20%_20%,#1f2937_0%,transparent_44%),radial-gradient(circle_at_80%_80%,#0f172a_0%,transparent_42%),#020617] md:rounded-none"
      >
        {windows.map((window) => (
          <Window
            key={window.id}
            x={window.x}
            y={window.y}
            width={window.width}
            height={window.height}
            zIndex={zOrder.indexOf(window.id) + 1}
            title={window.title}
            status={window.status}
            onActivate={() => activateWindow(window.id)}
            onMove={(x, y) => moveWindow(window.id, x, y)}
            onResize={(width, height) => resizeWindow(window.id, width, height)}
          >
            {window.id === "connections" ? (
              <ConnectionManager nodes={[...graphNodes]} />
            ) : (
              <div ref={terminalHostRef} className="h-full w-full" />
            )}
          </Window>
        ))}
      </div>
    </main>
  );
}

export default App;
