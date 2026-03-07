import { useParams } from "@tanstack/react-router";
import { AgentSettingsPanel } from "../components/AgentSettingsPanel";

export function SettingsRoute() {
  const { cockpit_id: cockpitId } = useParams({ from: "/agent-cockpit/$cockpit_id/settings" });
  return (
    <div className="h-full overflow-auto p-4 sm:p-6">
      <AgentSettingsPanel cockpitId={cockpitId} />
    </div>
  );
}
