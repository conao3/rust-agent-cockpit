import Add from "@spectrum-icons/workflow/Add";
import Delete from "@spectrum-icons/workflow/Delete";
import Magnify from "@spectrum-icons/workflow/Magnify";
import OpenIn from "@spectrum-icons/workflow/OpenIn";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button, Input, Label, SearchField } from "react-aria-components";
import { cockpitCreate, cockpitDelete, cockpitList, type CockpitDocument } from "../cockpitApi";
import { buildNewCockpitDocument, filterCockpits } from "./cockpitListModel";

const buttonBaseClass =
  "inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 outline-none transition hover:border-cyan-300 hover:text-cyan-100 focus-visible:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-50";

function statusLabel(row: CockpitDocument): string {
  return row.taskId ? "active" : "idle";
}

function agentLabel(row: CockpitDocument): string {
  return row.member ?? "—";
}

function lastUsedLabel(): string {
  return "—";
}

export function CockpitListRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const { data: rows = [], isLoading: loading, error: queryError } = useQuery({
    queryKey: ["cockpitList"] as const,
    queryFn: cockpitList,
  });

  const createMutation = useMutation({
    mutationFn: () => cockpitCreate({ cockpit: buildNewCockpitDocument() }),
    onMutate: () => setPendingId("new"),
    onSettled: () => setPendingId(null),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cockpitList"] as const }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => cockpitDelete({ id }),
    onSettled: () => setPendingId(null),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cockpitList"] as const }),
  });

  const error = queryError ? String(queryError) : createMutation.error ? String(createMutation.error) : deleteMutation.error ? String(deleteMutation.error) : null;

  const filtered = useMemo(() => filterCockpits(rows, query), [rows, query]);

  const onDelete = (id: string) => {
    if (!window.confirm(`Delete cockpit ${id}?`)) {
      return;
    }
    setPendingId(id);
    deleteMutation.mutate(id);
  };

  return (
    <div className="h-full overflow-auto p-4 sm:p-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h2 className="m-0 text-xl font-semibold tracking-[0.02em] text-slate-100">Cockpit List</h2>
              <p className="m-0 text-sm text-slate-400">Manage cockpit entries and jump into `/agent-cockpit/:cockpit_id`.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onPress={() => queryClient.invalidateQueries({ queryKey: ["cockpitList"] as const })} isDisabled={loading || pendingId !== null} className={buttonBaseClass}>
                reload
              </Button>
              <Button type="button" onPress={() => createMutation.mutate()} isDisabled={pendingId !== null} className={buttonBaseClass}>
                <Add size="S" />
                {pendingId === "new" ? "creating..." : "new cockpit"}
              </Button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <SearchField
              aria-label="search cockpits"
              className="flex w-full max-w-sm items-center gap-2 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            >
              <Magnify size="S" />
              <Label className="sr-only">search</Label>
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="search by id, name, cwd, task, member"
                className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
              />
            </SearchField>
            <span className="text-xs text-slate-500">
              {filtered.length} / {rows.length}
            </span>
          </div>

          {error ? (
            <p role="alert" className="mt-3 rounded-md border border-rose-900 bg-rose-950/60 px-3 py-2 text-sm text-rose-300">
              {error}
            </p>
          ) : null}
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70">
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/70 text-xs uppercase tracking-[0.08em] text-slate-400">
                  <th className="px-4 py-3 font-semibold">id</th>
                  <th className="px-4 py-3 font-semibold">name</th>
                  <th className="px-4 py-3 font-semibold">agents</th>
                  <th className="px-4 py-3 font-semibold">status</th>
                  <th className="px-4 py-3 font-semibold">last_used</th>
                  <th className="px-4 py-3 font-semibold">actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id} className="border-b border-slate-800/80 align-top">
                    <td className="px-4 py-3 font-mono text-xs text-slate-200">{row.id}</td>
                    <td className="px-4 py-3 text-slate-100">{row.title}</td>
                    <td className="px-4 py-3 text-slate-300">{agentLabel(row)}</td>
                    <td className="px-4 py-3">
                      <span className="rounded border border-slate-700 px-2 py-0.5 text-[11px] uppercase tracking-[0.08em] text-slate-300">
                        {statusLabel(row)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{lastUsedLabel()}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          onPress={() =>
                            navigate({
                              to: "/agent-cockpit/$cockpit_id",
                              params: { cockpit_id: row.id },
                            })
                          }
                          className={buttonBaseClass}
                        >
                          <OpenIn size="S" />
                          open
                        </Button>
                        <Button
                          type="button"
                          onPress={() => onDelete(row.id)}
                          isDisabled={pendingId === row.id || pendingId === "new"}
                          className={buttonBaseClass}
                        >
                          <Delete size="S" />
                          {pendingId === row.id ? "deleting..." : "delete"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!loading && filtered.length === 0 ? (
            <p className="m-0 px-4 py-5 text-sm text-slate-400">No cockpit entries found.</p>
          ) : null}
          {loading ? <p className="m-0 px-4 py-5 text-sm text-slate-400">Loading cockpits...</p> : null}
        </section>
      </div>
    </div>
  );
}
