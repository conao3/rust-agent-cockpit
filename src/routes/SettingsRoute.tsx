import { AgentSettingsPanel } from "../components/AgentSettingsPanel";

export function SettingsRoute() {
  return (
    <div className="h-full overflow-auto p-4 sm:p-6">
      <AgentSettingsPanel />
    </div>
  );
}
