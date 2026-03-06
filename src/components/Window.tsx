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
      className="window"
      aria-label={title}
      style={{
        left: x,
        top: y,
        width,
        height,
        zIndex,
      }}
      onMouseDown={() => onActivate?.()}
    >
      <header className="window-header" onMouseDown={handleDragStart}>
        <h1 className="window-title">{title}</h1>
        {status ? (
          <span className={`status status-${status}`} aria-live="polite">
            {status}
          </span>
        ) : null}
      </header>
      <div className="window-content">{children}</div>
      <button
        aria-label={`${title} resize`}
        className="window-resize-handle"
        type="button"
        onMouseDown={handleResizeStart}
      />
    </section>
  );
}
