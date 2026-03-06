import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "xterm";
import "xterm/css/xterm.css";
import "./App.css";
import { ConnectionManager } from "./components/ConnectionManager";
import { Window } from "./components/Window";

type PtyId = string | number;

type PtyCreateResponse = {
  id: string;
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

function App() {
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState("connecting");

  useEffect(() => {
    const host = terminalHostRef.current;
    if (!host) {
      return;
    }

    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      scrollback: 1000,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
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
      invoke("pty_write", { req: { id, data } }).catch((error) => {
        terminal.writeln(`\r\n[pty_write error] ${String(error)}`);
      });
    });

    const sendResize = () => {
      const id = ptyIdRef.current;
      if (!id) {
        return;
      }
      invoke("pty_resize", {
        req: {
          id,
          cols: terminal.cols,
          rows: terminal.rows,
        },
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
        const { id } = await invoke<PtyCreateResponse>("pty_create", {
          req: {
            cols: terminal.cols,
            rows: terminal.rows,
          },
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
        void invoke("pty_close", { req: { id } });
      }
      terminal.dispose();
      ptyIdRef.current = null;
    };
  }, []);

  return (
    <main className="app">
      <div className="app-grid">
        <Window title="Connections" status="connected">
          <ConnectionManager nodes={[...graphNodes]} />
        </Window>
        <Window title="PTY Terminal" status={status}>
          <div className="terminal-host" ref={terminalHostRef} />
        </Window>
      </div>
    </main>
  );
}

export default App;
