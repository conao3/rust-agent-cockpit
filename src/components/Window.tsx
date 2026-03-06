import type { ReactNode } from "react";

type WindowProps = {
  title: string;
  status?: string;
  children: ReactNode;
};

export function Window({ title, status, children }: WindowProps) {
  return (
    <section className="window" aria-label={title}>
      <header className="window-header">
        <h1 className="window-title">{title}</h1>
        {status ? (
          <span className={`status status-${status}`} aria-live="polite">
            {status}
          </span>
        ) : null}
      </header>
      <div className="window-content">{children}</div>
    </section>
  );
}
