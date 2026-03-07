import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { buildCockpitSearch } from "../mvpBootstrap";
import { type WorktreeListItem, worktreeList } from "../worktreeApi";

const members = ["Leader", "MemberA", "MemberB"] as const;

type BootstrapFormState = {
  taskId: string;
  member: (typeof members)[number];
  cwd: string;
};

const defaultFormState: BootstrapFormState = {
  taskId: "",
  member: "MemberA",
  cwd: "",
};

export function MvpRoute() {
  const [form, setForm] = useState<BootstrapFormState>(defaultFormState);
  const [rows, setRows] = useState<WorktreeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const listed = await worktreeList({ basedir: ".wt" });
      setRows(listed);
    } catch (loadError) {
      setRows([]);
      setError(String(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const search = useMemo(
    () =>
      buildCockpitSearch({
        taskId: form.taskId,
        member: form.member,
        cwd: form.cwd,
      }),
    [form],
  );

  return (
    <div className="h-full overflow-auto p-4 sm:p-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h2 className="m-0 text-xl font-semibold tracking-[0.02em] text-slate-100">MVP Session Bootstrap</h2>
              <p className="m-0 text-sm text-slate-400">Prepare task context, then start the cockpit terminal + graph session.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                to="/settings"
                className="rounded-md border border-slate-600 px-3 py-1.5 text-sm text-slate-200 transition hover:border-cyan-300 hover:text-cyan-100"
              >
                open settings
              </Link>
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="rounded-md border border-slate-600 px-3 py-1.5 text-sm text-slate-200 disabled:opacity-50"
              >
                {loading ? "loading..." : "reload worktrees"}
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-xs uppercase tracking-[0.08em] text-slate-400">
              task id
              <input
                aria-label="task id"
                value={form.taskId}
                onChange={(event) => setForm((current) => ({ ...current, taskId: event.target.value }))}
                placeholder="CON-31"
                className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm normal-case tracking-normal text-slate-100"
              />
            </label>
            <label className="space-y-1 text-xs uppercase tracking-[0.08em] text-slate-400">
              member
              <select
                aria-label="member"
                value={form.member}
                onChange={(event) =>
                  setForm((current) => ({ ...current, member: event.target.value as BootstrapFormState["member"] }))
                }
                className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm normal-case tracking-normal text-slate-100"
              >
                {members.map((member) => (
                  <option key={member} value={member}>
                    {member}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs uppercase tracking-[0.08em] text-slate-400">
              cwd
              <input
                aria-label="cwd"
                value={form.cwd}
                onChange={(event) => setForm((current) => ({ ...current, cwd: event.target.value }))}
                placeholder="./.wt/con-31-mvp"
                className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm normal-case tracking-normal text-slate-100"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <a
              href={`/agent-cockpit/default${search}`}
              className="rounded-md border border-cyan-400 bg-cyan-400 px-3 py-1.5 text-sm font-semibold text-slate-900 transition hover:brightness-110"
            >
              start cockpit session
            </a>
            <span className="text-xs text-slate-500">/agent-cockpit/default{search || ""}</span>
          </div>

          {error ? (
            <p role="alert" className="mt-3 rounded-md border border-rose-900 bg-rose-950/60 px-3 py-2 text-sm text-rose-300">
              {error}
            </p>
          ) : null}
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="m-0 text-sm font-semibold uppercase tracking-[0.08em] text-slate-300">Detected Worktrees</h3>
            <span className="text-xs text-slate-500">{rows.length} item(s)</span>
          </div>
          {rows.length === 0 ? (
            <p className="m-0 text-sm text-slate-400">
              {loading ? "Loading worktrees..." : "No worktrees detected under .wt"}
            </p>
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0">
              {rows.map((row) => (
                <li
                  key={row.worktreeDir}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-950/70 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="m-0 text-sm font-semibold text-slate-100">{row.branch}</p>
                    <p className="m-0 truncate text-xs text-slate-500">{row.worktreeDir}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-slate-300">
                      {row.opened ? "open" : "closed"}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setForm((current) => ({
                          ...current,
                          cwd: row.worktreeDir,
                        }));
                      }}
                      className="rounded border border-slate-600 px-2 py-1 text-xs uppercase tracking-[0.08em] text-slate-200 hover:border-cyan-300 hover:text-cyan-100"
                    >
                      use cwd
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
