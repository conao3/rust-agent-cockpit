import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  lifecycleStates,
  monitoringGetLifecycleState,
  parseLifecycleIngestResponse,
  taskGetLifecycle,
  taskRegisterDefinition,
  taskTransitionLifecycle,
  type LifecycleState,
  type TaskLifecycleSnapshot,
} from "../taskLifecycleApi";

const uiStates = ["queued", "sent", "acknowledged", "in_progress", "in_review", "done", "failed"] as const;
type UiState = (typeof uiStates)[number];

type MemberFilter = "all" | string;

type TrackedTask = {
  taskId: string;
  member: string;
  title: string | null;
  state: LifecycleState | null;
  updatedAtMs: number | null;
  historyLen: number;
  lastEventId: string | null;
};

type SlaStatus = "ok" | "warning" | "breach";

type TaskSla = {
  status: SlaStatus;
  elapsedMs: number | null;
};

const formatElapsed = (elapsedMs: number | null): string => {
  if (elapsedMs === null) {
    return "—";
  }
  if (elapsedMs < 1_000) {
    return "0s ago";
  }
  const seconds = Math.floor(elapsedMs / 1_000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
};

const toUiState = (task: TrackedTask): UiState => {
  const event = task.lastEventId?.toLowerCase() ?? "";
  if (event.includes("in_review")) {
    return "in_review";
  }
  if (event.includes("queued")) {
    return "queued";
  }
  switch (task.state) {
    case "sent":
      return "sent";
    case "ack":
      return "acknowledged";
    case "in_progress":
      return "in_progress";
    case "done":
      return "done";
    case "failed":
      return "failed";
    default:
      return "queued";
  }
};

const statusMeta: Record<UiState, { icon: string; textClass: string }> = {
  queued: { icon: "◌", textClass: "text-neutral-400" },
  sent: { icon: "➤", textClass: "text-neutral-300" },
  acknowledged: { icon: "◉", textClass: "text-sky-400" },
  in_progress: { icon: "⧗", textClass: "text-amber-400" },
  in_review: { icon: "⌁", textClass: "text-blue-400" },
  done: { icon: "✓", textClass: "text-emerald-400" },
  failed: { icon: "✕", textClass: "text-rose-400" },
};

const matrixOrder: UiState[] = ["queued", "sent", "acknowledged", "in_progress", "in_review", "done", "failed"];

const toSla = (task: TrackedTask, now: number): TaskSla => {
  if (task.updatedAtMs === null) {
    return { status: "ok", elapsedMs: null };
  }
  const elapsedMs = Math.max(0, now - task.updatedAtMs);
  if (task.state === "done" || task.state === "failed") {
    return { status: "ok", elapsedMs };
  }
  const thresholdMs = task.state === "sent" ? 60_000 : 120_000;
  if (elapsedMs >= thresholdMs) {
    return { status: "breach", elapsedMs };
  }
  if (elapsedMs >= thresholdMs * 0.75) {
    return { status: "warning", elapsedMs };
  }
  return { status: "ok", elapsedMs };
};

const applySnapshot = (current: TrackedTask[], snapshot: TaskLifecycleSnapshot): TrackedTask[] => {
  const key = `${snapshot.taskId}:${snapshot.member}`;
  const nextRow: TrackedTask = {
    taskId: snapshot.taskId,
    member: snapshot.member,
    title: snapshot.title,
    state: snapshot.state,
    updatedAtMs: snapshot.updatedAtMs,
    historyLen: snapshot.historyLen,
    lastEventId: snapshot.lastEventId,
  };
  const index = current.findIndex((entry) => `${entry.taskId}:${entry.member}` === key);
  if (index < 0) {
    return [...current, nextRow];
  }
  const copy = [...current];
  copy[index] = {
    ...copy[index],
    ...nextRow,
  };
  return copy;
};

const updateFromIngest = (current: TrackedTask[], payload: ReturnType<typeof parseLifecycleIngestResponse>): TrackedTask[] => {
  const key = `${payload.taskId}:${payload.member}`;
  const index = current.findIndex((entry) => `${entry.taskId}:${entry.member}` === key);
  if (index < 0) {
    return [
      ...current,
      {
        taskId: payload.taskId,
        member: payload.member,
        title: null,
        state: payload.currentState,
        updatedAtMs: payload.updatedAtMs,
        historyLen: 0,
        lastEventId: payload.eventKey,
      },
    ];
  }
  const copy = [...current];
  copy[index] = {
    ...copy[index],
    state: payload.currentState,
    updatedAtMs: payload.updatedAtMs,
    lastEventId: payload.eventKey,
  };
  return copy;
};

const initialTasks: TrackedTask[] = [
  { taskId: "CON-107", member: "MemberB", title: "Task Lifecycle Monitor", state: "in_progress", updatedAtMs: null, historyLen: 0, lastEventId: null },
];

export function TaskLifecycleRoute() {
  const { cockpit_id: cockpitId } = useParams({ from: "/agent-cockpit/$cockpit_id/tasks" });
  const [tasks, setTasks] = useState<TrackedTask[]>(initialTasks);
  const [taskIdInput, setTaskIdInput] = useState("CON-107");
  const [memberInput, setMemberInput] = useState("MemberB");
  const [titleInput, setTitleInput] = useState("Task Lifecycle Monitor");
  const [statusFilter, setStatusFilter] = useState<UiState | "all">("all");
  const [memberFilter, setMemberFilter] = useState<MemberFilter>("all");
  const [query, setQuery] = useState("");
  const [tick, setTick] = useState(() => Date.now());
  const [message, setMessage] = useState<string | null>(null);
  const [lastRealtime, setLastRealtime] = useState<number | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTick(Date.now());
    }, 1_000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const refresh = async () => {
    setMessage(null);
    const refreshed = await Promise.all(
      tasks.map(async (entry) => {
        try {
          const snapshot = await taskGetLifecycle({ taskId: entry.taskId, member: entry.member });
          return {
            ...entry,
            title: snapshot.title,
            state: snapshot.state,
            updatedAtMs: snapshot.updatedAtMs,
            historyLen: snapshot.historyLen,
            lastEventId: snapshot.lastEventId,
          } satisfies TrackedTask;
        } catch {
          const fallback = await monitoringGetLifecycleState({ taskId: entry.taskId, member: entry.member });
          if (!fallback) {
            return entry;
          }
          return {
            ...entry,
            state: fallback.state,
            updatedAtMs: fallback.updatedAtMs,
            historyLen: fallback.historyLen,
            lastEventId: fallback.lastEventId,
          } satisfies TrackedTask;
        }
      }),
    );
    setTasks(refreshed);
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let detach: UnlistenFn | undefined;
    const subscribe = async () => {
      detach = await listen<unknown>("monitoring-lifecycle", (event) => {
        try {
          const payload = parseLifecycleIngestResponse(event.payload);
          setTasks((current) => updateFromIngest(current, payload));
          setLastRealtime(Date.now());
        } catch {
          // Ignore non-lifecycle payloads.
        }
      });
    };
    void subscribe();
    return () => {
      if (detach) {
        detach();
      }
    };
  }, []);

  const onRegister = async () => {
    setMessage(null);
    try {
      const snapshot = await taskRegisterDefinition({
        taskId: taskIdInput.trim(),
        member: memberInput.trim(),
        title: titleInput.trim() || undefined,
      });
      setTasks((current) => applySnapshot(current, snapshot));
      setMessage("registered");
    } catch (error) {
      setMessage(String(error));
    }
  };

  const onTransition = async (task: TrackedTask, state: LifecycleState) => {
    setMessage(null);
    try {
      const snapshot = await taskTransitionLifecycle({
        taskId: task.taskId,
        member: task.member,
        state,
        source: "ui_task_lifecycle_monitor",
      });
      setTasks((current) => applySnapshot(current, snapshot));
      setMessage(`transitioned ${task.taskId}/${task.member} -> ${state}`);
    } catch (error) {
      setMessage(String(error));
    }
  };

  const memberChoices = useMemo(() => {
    const members = Array.from(new Set(tasks.map((task) => task.member))).sort();
    return ["all", ...members];
  }, [tasks]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return tasks.filter((task) => {
      const uiState = toUiState(task);
      if (statusFilter !== "all" && uiState !== statusFilter) {
        return false;
      }
      if (memberFilter !== "all" && task.member !== memberFilter) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      return (
        task.taskId.toLowerCase().includes(normalizedQuery) ||
        task.member.toLowerCase().includes(normalizedQuery) ||
        (task.title ?? "").toLowerCase().includes(normalizedQuery)
      );
    });
  }, [memberFilter, query, statusFilter, tasks]);

  const counts = useMemo(() => {
    const result: Record<UiState, number> = {
      queued: 0,
      sent: 0,
      acknowledged: 0,
      in_progress: 0,
      in_review: 0,
      done: 0,
      failed: 0,
    };
    for (const task of tasks) {
      result[toUiState(task)] += 1;
    }
    return result;
  }, [tasks]);

  const alerts = useMemo(() => {
    return filtered
      .map((task) => ({ task, sla: toSla(task, tick) }))
      .filter((entry) => entry.sla.status !== "ok")
      .sort((a, b) => (b.sla.elapsedMs ?? 0) - (a.sla.elapsedMs ?? 0));
  }, [filtered, tick]);

  return (
    <div className="h-full overflow-auto bg-[#0c0c0c] p-6 sm:p-8">
      <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[#1f1f1f] pb-4">
          <div>
            <p className="m-0 font-mono text-xs text-[#737373]">task_lifecycle_monitor</p>
            <h2 className="m-0 font-mono text-2xl font-semibold text-[#e5e5e5]">Task Lifecycle Monitor</h2>
            <p className="m-0 mt-1 font-mono text-xs text-[#737373]">
              real-time task orchestration state across agents
            </p>
          </div>
          <div className="text-right font-mono text-xs text-[#737373]">
            <p className="m-0">cockpit: {cockpitId}</p>
            <p className="m-0">realtime: {lastRealtime ? formatElapsed(tick - lastRealtime) : "waiting"}</p>
            <p className="m-0">tracked: {tasks.length}</p>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          {matrixOrder.map((state) => {
            const meta = statusMeta[state];
            return (
              <article key={state} className="rounded border border-[#1f1f1f] bg-[#171717] p-3 font-mono">
                <p className={`m-0 text-[11px] uppercase tracking-[0.08em] ${meta.textClass}`}>{state}</p>
                <p className={`m-0 mt-1 text-xl font-semibold ${meta.textClass}`}>
                  {meta.icon} {counts[state]}
                </p>
              </article>
            );
          })}
        </section>

        <section className="rounded border border-[#1f1f1f] bg-[#171717] p-4">
          <div className="grid gap-3 md:grid-cols-5">
            <input
              aria-label="task id"
              value={taskIdInput}
              onChange={(event) => setTaskIdInput(event.target.value)}
              placeholder="CON-107"
              className="rounded border border-[#2a2a2a] bg-[#111111] px-3 py-2 font-mono text-sm text-[#e5e5e5]"
            />
            <input
              aria-label="member"
              value={memberInput}
              onChange={(event) => setMemberInput(event.target.value)}
              placeholder="MemberB"
              className="rounded border border-[#2a2a2a] bg-[#111111] px-3 py-2 font-mono text-sm text-[#e5e5e5]"
            />
            <input
              aria-label="title"
              value={titleInput}
              onChange={(event) => setTitleInput(event.target.value)}
              placeholder="Task title"
              className="rounded border border-[#2a2a2a] bg-[#111111] px-3 py-2 font-mono text-sm text-[#e5e5e5]"
            />
            <button
              type="button"
              onClick={() => void onRegister()}
              className="rounded border border-[#22c55e] bg-[#0f2d1a] px-3 py-2 font-mono text-sm font-semibold text-[#22c55e]"
            >
              register
            </button>
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded border border-[#3b82f6] bg-[#10213f] px-3 py-2 font-mono text-sm font-semibold text-[#60a5fa]"
            >
              refresh
            </button>
          </div>
          {message ? <p className="m-0 mt-2 font-mono text-xs text-[#a3a3a3]">{message}</p> : null}
        </section>

        <section className="grid gap-4 xl:grid-cols-[1fr_360px]">
          <article className="rounded border border-[#1f1f1f] bg-[#171717] p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <label className="font-mono text-xs text-[#737373]">
                status
                <select
                  aria-label="status filter"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as UiState | "all")}
                  className="ml-2 rounded border border-[#2a2a2a] bg-[#111111] px-2 py-1 text-xs text-[#e5e5e5]"
                >
                  <option value="all">all</option>
                  {matrixOrder.map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </select>
              </label>
              <label className="font-mono text-xs text-[#737373]">
                member
                <select
                  aria-label="member filter"
                  value={memberFilter}
                  onChange={(event) => setMemberFilter(event.target.value)}
                  className="ml-2 rounded border border-[#2a2a2a] bg-[#111111] px-2 py-1 text-xs text-[#e5e5e5]"
                >
                  {memberChoices.map((member) => (
                    <option key={member} value={member}>
                      {member}
                    </option>
                  ))}
                </select>
              </label>
              <input
                aria-label="search task"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="filter task/member/title"
                className="min-w-[220px] flex-1 rounded border border-[#2a2a2a] bg-[#111111] px-2 py-1 font-mono text-xs text-[#e5e5e5]"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse font-mono text-xs">
                <thead>
                  <tr className="border-b border-[#1f1f1f] text-left text-[#525252]">
                    <th className="py-2 pr-3">task_id</th>
                    <th className="py-2 pr-3">member</th>
                    <th className="py-2 pr-3">current_state</th>
                    <th className="py-2 pr-3">last_heartbeat</th>
                    <th className="py-2 pr-3">sla_status</th>
                    <th className="py-2">actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((task) => {
                    const uiState = toUiState(task);
                    const meta = statusMeta[uiState];
                    const sla = toSla(task, tick);
                    const slaClass =
                      sla.status === "breach"
                        ? "text-rose-400"
                        : sla.status === "warning"
                          ? "text-amber-400"
                          : "text-emerald-400";
                    return (
                      <tr key={`${task.taskId}:${task.member}`} className="border-b border-[#1f1f1f] text-[#e5e5e5]">
                        <td className="py-2 pr-3 text-[#a3a3a3]">{task.taskId}</td>
                        <td className="py-2 pr-3">{task.member}</td>
                        <td className={`py-2 pr-3 ${meta.textClass}`}>
                          {meta.icon} {uiState}
                        </td>
                        <td className="py-2 pr-3 text-[#737373]">{formatElapsed(sla.elapsedMs)}</td>
                        <td className={`py-2 pr-3 uppercase ${slaClass}`}>{sla.status}</td>
                        <td className="py-2">
                          <div className="flex flex-wrap gap-1">
                            {lifecycleStates.map((state) => (
                              <button
                                key={state}
                                type="button"
                                onClick={() => void onTransition(task, state)}
                                className="rounded border border-[#2a2a2a] px-1.5 py-0.5 text-[10px] text-[#a3a3a3]"
                              >
                                {state}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </article>

          <aside className="rounded border border-[#1f1f1f] bg-[#171717] p-4 font-mono">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="m-0 text-sm font-semibold text-rose-400">sla_alerts</h3>
              <span className="text-xs text-rose-300">{alerts.length} active</span>
            </div>
            <div className="space-y-2">
              {alerts.length === 0 ? <p className="m-0 text-xs text-[#737373]">no active SLA alerts</p> : null}
              {alerts.map(({ task, sla }) => (
                <article
                  key={`${task.taskId}:${task.member}`}
                  className={`rounded border p-2 ${
                    sla.status === "breach" ? "border-rose-500/40 bg-rose-950/20" : "border-amber-500/40 bg-amber-950/20"
                  }`}
                >
                  <p className="m-0 text-xs text-[#e5e5e5]">
                    {task.taskId} - {task.member}
                  </p>
                  <p className="m-0 mt-1 text-[11px] text-[#737373]">
                    elapsed: {formatElapsed(sla.elapsedMs)} / threshold {task.state === "sent" ? "60s" : "120s"}
                  </p>
                </article>
              ))}
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}
