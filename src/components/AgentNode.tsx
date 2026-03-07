import { Handle, Position, type NodeProps } from "reactflow";

export type AgentNodeData = {
  label: string;
  role: "leader" | "member";
  status: "online" | "idle" | "error";
};

const statusColors = {
  online: "bg-emerald-400",
  idle: "bg-slate-500",
  error: "bg-red-400",
} as const;

const roleBorderColors = {
  leader: "border-emerald-500",
  member: "border-slate-600",
} as const;

export function AgentNode({ data }: NodeProps<AgentNodeData>) {
  return (
    <div
      className={`rounded-lg border ${roleBorderColors[data.role]} bg-slate-950/90 px-4 py-3 shadow-lg`}
    >
      <Handle type="target" position={Position.Top} className="!bg-slate-500" />
      <div className="flex items-center gap-2">
        <div className={`h-2 w-2 rounded-full ${statusColors[data.status]}`} />
        <span className="text-sm font-semibold text-slate-100">{data.label}</span>
      </div>
      <div className="mt-0.5 text-[11px] text-slate-400">{data.role}</div>
      <Handle type="source" position={Position.Bottom} className="!bg-slate-500" />
    </div>
  );
}
