import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "xterm";
import "xterm/css/xterm.css";
import "./App.css";

type PtyId = string | number;

type PtyOutputPayload =
  | string
  | {
      id?: PtyId;
      ptyId?: PtyId;
      data?: string;
      output?: string;
    };

function App() {
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const ptyIdRef = useRef<PtyId | null>(null);
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
      if (id === null) {
        return;
      }
      invoke("pty_write", { id, data }).catch((error) => {
        terminal.writeln(`\r\n[pty_write error] ${String(error)}`);
      });
    });

    const onResize = () => {
      fitAddon.fit();
    };
    window.addEventListener("resize", onResize);

    const bootstrap = async () => {
      try {
        const id = await invoke<PtyId>("pty_create");
        ptyIdRef.current = id;

        detachEvent = await listen<PtyOutputPayload>("pty-output", (event) => {
          const payload = event.payload;
          if (typeof payload === "string") {
            terminal.write(payload);
            return;
          }

          const eventId = payload.ptyId ?? payload.id;
          if (eventId !== undefined && eventId !== ptyIdRef.current) {
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
      terminal.dispose();
      ptyIdRef.current = null;
    };
  }, []);

  return (
    <main className="app">
      <header className="app-header">
        <h1>PTY Terminal</h1>
        <span className={`status status-${status}`}>{status}</span>
      </header>
      <section className="terminal-panel">
        <div className="terminal-host" ref={terminalHostRef} />
      </section>
    </main>
  );
}

export default App;
