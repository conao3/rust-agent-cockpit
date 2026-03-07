import { useParams } from "@tanstack/react-router";
import { PlaceholderRoute } from "./PlaceholderRoute";

export function WorktreeManagerRoute() {
  const { cockpit_id: cockpitId } = useParams({ from: "/agent-cockpit/$cockpit_id/worktrees" });
  return (
    <div className="h-full overflow-auto p-4 sm:p-6">
      <div className="m-0 mb-4 text-xs uppercase tracking-[0.08em] text-slate-500">cockpit: {cockpitId}</div>
      <PlaceholderRoute />
    </div>
  );
}
