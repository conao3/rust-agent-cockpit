import { useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  type Edge,
  type Node,
} from "reactflow";
import "reactflow/dist/style.css";
import { AgentNode, type AgentNodeData } from "./components/AgentNode";
import { TerminalNode, type TerminalNodeData } from "./components/TerminalNode";

export const resolvePtyCreateContext = (search: string) => {
  const params = new URLSearchParams(search);
  const firstNonEmpty = (...values: Array<string | null>): string | undefined => {
    for (const value of values) {
      if (value) {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }
    }
    return undefined;
  };
  return {
    cwd: firstNonEmpty(params.get("cwd")),
    taskId: firstNonEmpty(params.get("pty"), params.get("task_id"), params.get("taskId")),
    member: firstNonEmpty(params.get("agent"), params.get("member")),
  };
};

const nodeTypes = {
  agent: AgentNode,
  terminal: TerminalNode,
} as const;

function App() {
  const context = useMemo(() => resolvePtyCreateContext(window.location.search), []);

  const initialNodes: Node<AgentNodeData | TerminalNodeData>[] = useMemo(
    () => [
      {
        id: "leader",
        type: "agent",
        position: { x: 300, y: 40 },
        data: { label: "Leader", role: "leader", status: "online" } as AgentNodeData,
      },
      {
        id: "member-a",
        type: "agent",
        position: { x: 100, y: 220 },
        data: { label: "Member A", role: "member", status: "online" } as AgentNodeData,
      },
      {
        id: "member-b",
        type: "agent",
        position: { x: 500, y: 220 },
        data: { label: "Member B", role: "member", status: "idle" } as AgentNodeData,
      },
      {
        id: "terminal-leader",
        type: "terminal",
        position: { x: 700, y: 20 },
        data: {
          label: "Leader PTY",
          cwd: context.cwd,
          taskId: context.taskId,
          member: context.member,
        } as TerminalNodeData,
      },
    ],
    [context],
  );

  const initialEdges: Edge[] = useMemo(
    () => [
      {
        id: "e-leader-a",
        source: "leader",
        target: "member-a",
        type: "smoothstep",
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: "#22d3ee" },
      },
      {
        id: "e-leader-b",
        source: "leader",
        target: "member-b",
        type: "smoothstep",
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: "#22d3ee" },
      },
    ],
    [],
  );

  return (
    <main className="h-full w-full bg-[#030712]">
      <ReactFlow
        defaultNodes={initialNodes}
        defaultEdges={initialEdges}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
        maxZoom={2}
      >
        <Background color="#1e293b" gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </main>
  );
}

export default App;
