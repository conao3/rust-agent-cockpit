import { useParams } from "@tanstack/react-router";
import { FormEvent, useState } from "react";
import {
  LinearMessageIngestResponse,
  linearIngestWebhookComment,
} from "../linearInboxApi";

type FormState = {
  issueId: string;
  body: string;
  targetMember: string;
  commentId: string;
  source: string;
};

const initialForm: FormState = {
  issueId: "",
  body: "",
  targetMember: "",
  commentId: "",
  source: "linear-webhook",
};

const labelClass = "text-xs font-semibold uppercase tracking-[0.08em] text-slate-400";
const inputClass =
  "w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-300";

export function LinearInboxRoute() {
  const { cockpit_id: cockpitId } = useParams({ from: "/agent-cockpit/$cockpit_id/inbox" });
  const [form, setForm] = useState<FormState>(initialForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [response, setResponse] = useState<LinearMessageIngestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResponse(null);
    setIsSubmitting(true);
    try {
      const result = await linearIngestWebhookComment({
        issueId: form.issueId,
        body: form.body,
        targetMember: form.targetMember || undefined,
        commentId: form.commentId || undefined,
        source: form.source || undefined,
      });
      setResponse(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to ingest linear comment");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-6 p-6 text-slate-100">
      <header className="space-y-1">
        <h2 className="m-0 text-2xl font-bold tracking-[0.02em]">Linear Inbox</h2>
        <div className="m-0 text-sm text-slate-400">Cockpit: {cockpitId}</div>
      </header>

      <form className="grid gap-4 rounded-xl border border-slate-800 bg-slate-950/70 p-4" onSubmit={onSubmit}>
        <label className="grid gap-1">
          <span className={labelClass}>Issue ID</span>
          <input
            className={inputClass}
            value={form.issueId}
            onChange={(e) => setForm((prev) => ({ ...prev, issueId: e.target.value }))}
            placeholder="ENG-123"
            required
          />
        </label>
        <label className="grid gap-1">
          <span className={labelClass}>Comment Body</span>
          <textarea
            className={`${inputClass} min-h-28 resize-y`}
            value={form.body}
            onChange={(e) => setForm((prev) => ({ ...prev, body: e.target.value }))}
            placeholder="Status update..."
            required
          />
        </label>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1">
            <span className={labelClass}>Target Member</span>
            <input
              className={inputClass}
              value={form.targetMember}
              onChange={(e) => setForm((prev) => ({ ...prev, targetMember: e.target.value }))}
              placeholder="MemberA"
            />
          </label>
          <label className="grid gap-1">
            <span className={labelClass}>Comment ID</span>
            <input
              className={inputClass}
              value={form.commentId}
              onChange={(e) => setForm((prev) => ({ ...prev, commentId: e.target.value }))}
              placeholder="lin_cmt_abc123"
            />
          </label>
        </div>
        <label className="grid gap-1">
          <span className={labelClass}>Source</span>
          <input
            className={inputClass}
            value={form.source}
            onChange={(e) => setForm((prev) => ({ ...prev, source: e.target.value }))}
            placeholder="linear-webhook"
          />
        </label>
        <button
          type="submit"
          className="inline-flex w-fit items-center rounded-md border border-cyan-300 bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isSubmitting}
        >
          {isSubmitting ? "ingesting..." : "Ingest Comment"}
        </button>
      </form>

      {error ? <div className="m-0 rounded-md border border-rose-800 bg-rose-950/50 p-3 text-sm text-rose-200">{error}</div> : null}

      {response ? (
        <pre className="m-0 overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs leading-5 text-slate-200">
          {JSON.stringify(response, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
