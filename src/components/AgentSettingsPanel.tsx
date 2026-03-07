import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  agentSettingsGet,
  agentSettingsSave,
  type AgentSettings,
  type AgentSettingsDocument,
} from "../agentSettingsApi";

const emptyDocument: AgentSettingsDocument = {
  version: 1,
  agents: [],
};

function cloneDocument(doc: AgentSettingsDocument): AgentSettingsDocument {
  return {
    version: doc.version,
    agents: doc.agents.map((agent) => ({
      ...agent,
      toolRestrictions: [...agent.toolRestrictions],
    })),
  };
}

function nextAgentId(existing: AgentSettings[]): string {
  const used = new Set(existing.map((agent) => agent.id));
  let index = existing.length + 1;
  while (used.has(`agent-${index}`)) {
    index += 1;
  }
  return `agent-${index}`;
}

function normalizeSettings(settings: AgentSettingsDocument): AgentSettingsDocument {
  return {
    version: Number.isFinite(settings.version) && settings.version > 0 ? Math.floor(settings.version) : 1,
    agents: settings.agents.map((agent) => ({
      id: agent.id.trim(),
      name: agent.name.trim(),
      command: agent.command.trim(),
      systemPrompt: agent.systemPrompt?.trim() ? agent.systemPrompt.trim() : null,
      toolRestrictions: agent.toolRestrictions
        .map((tool) => tool.trim())
        .filter((tool) => tool.length > 0),
    })),
  };
}

type AgentSettingsPanelProps = {
  cockpitId: string;
};

export function AgentSettingsPanel({ cockpitId }: AgentSettingsPanelProps) {
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState<AgentSettingsDocument>(emptyDocument);
  const [baseline, setBaseline] = useState<AgentSettingsDocument>(emptyDocument);
  const [notice, setNotice] = useState<string | null>(null);

  const { data: fetched, isLoading: loading, error: queryError } = useQuery({
    queryKey: ["agentSettings", cockpitId] as const,
    queryFn: () => agentSettingsGet({ cockpitId }),
  });

  useEffect(() => {
    if (!fetched) {
      return;
    }
    const snapshot = cloneDocument(fetched);
    setSettings(snapshot);
    setBaseline(snapshot);
  }, [fetched]);

  const saveMutation = useMutation({
    mutationFn: () => agentSettingsSave({ cockpitId, settings: normalizeSettings(settings) }),
    onSuccess: (saved) => {
      const snapshot = cloneDocument(saved);
      setSettings(snapshot);
      setBaseline(snapshot);
      setNotice("settings saved");
      queryClient.invalidateQueries({ queryKey: ["agentSettings", cockpitId] as const });
    },
  });

  const error = queryError ? String(queryError) : saveMutation.error ? String(saveMutation.error) : null;
  const saving = saveMutation.isPending;
  const dirty = useMemo(() => JSON.stringify(settings) !== JSON.stringify(baseline), [settings, baseline]);

  const updateAgent = <K extends keyof AgentSettings>(index: number, key: K, value: AgentSettings[K]) => {
    setSettings((current) => ({
      ...current,
      agents: current.agents.map((agent, agentIndex) => (agentIndex === index ? { ...agent, [key]: value } : agent)),
    }));
    setNotice(null);
  };

  const addAgent = () => {
    setSettings((current) => ({
      ...current,
      agents: [
        ...current.agents,
        {
          id: nextAgentId(current.agents),
          name: "",
          command: "codex",
          systemPrompt: null,
          toolRestrictions: [],
        },
      ],
    }));
    setNotice(null);
  };

  const removeAgent = (index: number) => {
    setSettings((current) => ({
      ...current,
      agents: current.agents.filter((_, agentIndex) => agentIndex !== index),
    }));
    setNotice(null);
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="m-0 text-xl font-semibold tracking-[0.02em] text-slate-100">Agent Settings</h2>
            <p className="m-0 text-sm text-slate-400">Edit runtime profiles and save to .agent-cockpit/agent-settings.toml.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["agentSettings", cockpitId] as const })}
              disabled={loading || saving}
              className="rounded-md border border-slate-600 px-3 py-1.5 text-sm text-slate-200 disabled:opacity-50"
            >
              reload
            </button>
            <button
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={loading || saving || !dirty}
              className="rounded-md border border-cyan-400 bg-cyan-400 px-3 py-1.5 text-sm font-semibold text-slate-900 disabled:opacity-50"
            >
              {saving ? "saving..." : "save"}
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.09em]">
          <label className="flex items-center gap-2 text-slate-400">
            version
            <input
              type="number"
              min={1}
              aria-label="settings version"
              value={settings.version}
              onChange={(event) => {
                const next = Number.parseInt(event.target.value, 10);
                setSettings((current) => ({
                  ...current,
                  version: Number.isNaN(next) ? 1 : Math.max(1, next),
                }));
                setNotice(null);
              }}
              className="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
            />
          </label>
          <span className="text-slate-500">agents: {settings.agents.length}</span>
          {dirty ? <span className="text-amber-300">unsaved changes</span> : <span className="text-emerald-300">saved</span>}
        </div>

        {error ? (
          <p role="alert" className="mt-3 rounded-md border border-rose-900 bg-rose-950/60 px-3 py-2 text-sm text-rose-300">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="mt-3 rounded-md border border-emerald-900 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">{notice}</p>
        ) : null}
      </section>

      <section className="space-y-3">
        {settings.agents.map((agent, index) => (
          <article key={`${agent.id}-${index}`} className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="m-0 text-sm font-semibold uppercase tracking-[0.08em] text-slate-300">agent {index + 1}</h3>
              <button
                type="button"
                onClick={() => removeAgent(index)}
                className="rounded border border-rose-900 px-2 py-1 text-xs uppercase tracking-[0.08em] text-rose-300"
              >
                remove
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs uppercase tracking-[0.08em] text-slate-400">
                id
                <input
                  aria-label={`agent ${index + 1} id`}
                  value={agent.id}
                  onChange={(event) => updateAgent(index, "id", event.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm normal-case tracking-normal text-slate-100"
                />
              </label>
              <label className="space-y-1 text-xs uppercase tracking-[0.08em] text-slate-400">
                name
                <input
                  aria-label={`agent ${index + 1} name`}
                  value={agent.name}
                  onChange={(event) => updateAgent(index, "name", event.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm normal-case tracking-normal text-slate-100"
                />
              </label>
              <label className="space-y-1 text-xs uppercase tracking-[0.08em] text-slate-400 sm:col-span-2">
                command
                <input
                  aria-label={`agent ${index + 1} command`}
                  value={agent.command}
                  onChange={(event) => updateAgent(index, "command", event.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm normal-case tracking-normal text-slate-100"
                />
              </label>
              <label className="space-y-1 text-xs uppercase tracking-[0.08em] text-slate-400 sm:col-span-2">
                system prompt
                <textarea
                  aria-label={`agent ${index + 1} system prompt`}
                  value={agent.systemPrompt ?? ""}
                  onChange={(event) => updateAgent(index, "systemPrompt", event.target.value || null)}
                  rows={3}
                  className="w-full resize-y rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm normal-case tracking-normal text-slate-100"
                />
              </label>
              <label className="space-y-1 text-xs uppercase tracking-[0.08em] text-slate-400 sm:col-span-2">
                tool restrictions (comma or newline separated)
                <textarea
                  aria-label={`agent ${index + 1} tool restrictions`}
                  value={agent.toolRestrictions.join("\n")}
                  onChange={(event) =>
                    updateAgent(
                      index,
                      "toolRestrictions",
                      event.target.value
                        .split(/[\n,]/)
                        .map((tool) => tool.trim())
                        .filter((tool) => tool.length > 0),
                    )
                  }
                  rows={3}
                  className="w-full resize-y rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm normal-case tracking-normal text-slate-100"
                />
              </label>
            </div>
          </article>
        ))}

        <button
          type="button"
          onClick={addAgent}
          className="w-full rounded-xl border border-dashed border-slate-600 px-4 py-3 text-sm font-semibold uppercase tracking-[0.1em] text-slate-300"
        >
          add agent
        </button>
      </section>
    </div>
  );
}
