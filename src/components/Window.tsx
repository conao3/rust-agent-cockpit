import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";

type WindowProps = {
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  title: string;
  status?: string;
  children: ReactNode;
  onActivate?: () => void;
  onMove?: (x: number, y: number) => void;
  onResize?: (width: number, height: number) => void;
};

type DragState =
  | {
      originMouseX: number;
      originMouseY: number;
      originX: number;
      originY: number;
    }
  | null;

type ResizeState =
  | {
      originMouseX: number;
      originMouseY: number;
      originWidth: number;
      originHeight: number;
    }
  | null;

const statusClassNames: Record<string, string> = {
  connecting: "bg-blue-950 text-blue-200",
  connected: "bg-emerald-950 text-emerald-200",
  error: "bg-red-950 text-red-200",
};

export function Window({
  x,
  y,
  width,
  height,
  zIndex,
  title,
  status,
  children,
  onActivate,
  onMove,
  onResize,
}: WindowProps) {
  const dragStateRef = useRef<DragState>(null);
  const resizeStateRef = useRef<ResizeState>(null);

  useEffect(() => {
    const onMouseMove = (event: globalThis.MouseEvent) => {
      const dragState = dragStateRef.current;
      if (dragState && onMove) {
        const deltaX = event.clientX - dragState.originMouseX;
        const deltaY = event.clientY - dragState.originMouseY;
        onMove(dragState.originX + deltaX, dragState.originY + deltaY);
      }

      const resizeState = resizeStateRef.current;
      if (resizeState && onResize) {
        const deltaX = event.clientX - resizeState.originMouseX;
        const deltaY = event.clientY - resizeState.originMouseY;
        onResize(resizeState.originWidth + deltaX, resizeState.originHeight + deltaY);
      }
    };

    const onMouseUp = () => {
      dragStateRef.current = null;
      resizeStateRef.current = null;
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onMove, onResize]);

  const handleDragStart = (event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onActivate?.();
    dragStateRef.current = {
      originMouseX: event.clientX,
      originMouseY: event.clientY,
      originX: x,
      originY: y,
    };
  };

  const handleResizeStart = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onActivate?.();
    resizeStateRef.current = {
      originMouseX: event.clientX,
      originMouseY: event.clientY,
      originWidth: width,
      originHeight: height,
    };
  };

  return (
    <section
      aria-label={title}
      className="absolute flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-950/90 shadow-[0_16px_40px_rgba(1,4,9,0.66)]"
      style={{
        left: x,
        top: y,
        width,
        height,
        zIndex,
      }}
      onMouseDown={() => onActivate?.()}
    >
      <header
        className="flex cursor-grab select-none items-center justify-between border-b border-slate-700 px-3 py-2 active:cursor-grabbing"
        onMouseDown={handleDragStart}
      >
        <h1 className="m-0 text-sm font-semibold uppercase tracking-[0.04em] text-slate-100">{title}</h1>
        {status ? (
          <span
            aria-live="polite"
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${statusClassNames[status] ?? "bg-slate-800 text-slate-200"}`}
          >
            {status}
          </span>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      <button
        aria-label={`${title} resize`}
        className="window-resize-handle absolute right-0 bottom-0 h-3.5 w-3.5 cursor-nwse-resize rounded-none border-none"
        type="button"
        onMouseDown={handleResizeStart}
      />
    </section>
  );
}
