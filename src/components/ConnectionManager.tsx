import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  type Edge,
  type Node,
} from "reactflow";
import "reactflow/dist/style.css";

type GraphNode = {
  id: string;
  label: string;
};

type Connection = {
  id: string;
  fromId: string;
  toId: string;
  description: string;
};

type ConnectionManagerProps = {
  nodes: GraphNode[];
};

const connections: Connection[] = [
  {
    id: "conn-1",
    fromId: "leader",
    toId: "member-a",
    description: "task delegation",
  },
  {
    id: "conn-2",
    fromId: "leader",
    toId: "member-b",
    description: "status updates",
  },
];

const nodePositions = [
  { x: 160, y: 40 },
  { x: 40, y: 220 },
  { x: 280, y: 220 },
];

const fallbackNodePosition = { x: 160, y: 130 };

export function buildFlowNodes(nodes: GraphNode[]): Node[] {
  return nodes.map((node, index) => ({
    id: node.id,
    type: "default",
    position: nodePositions[index] ?? fallbackNodePosition,
    data: {
      label: node.label,
    },
    draggable: false,
    selectable: false,
  }));
}

export function buildFlowEdges(conns: Connection[]): Edge[] {
  return conns.map((connection) => ({
    id: connection.id,
    source: connection.fromId,
    target: connection.toId,
    type: "smoothstep",
    markerEnd: {
      type: MarkerType.ArrowClosed,
    },
    animated: true,
    label: connection.description || undefined,
    selectable: false,
  }));
}

export function ConnectionManager({ nodes }: ConnectionManagerProps) {
  return (
    <div className="flex h-full flex-col gap-2.5 p-2.5">
      <div
        className="connection-graph h-[220px] overflow-hidden rounded-lg border border-slate-800 bg-slate-950"
        aria-label="connection graph"
        data-testid="connection-graph"
      >
        <ReactFlow
          fitView
          nodes={buildFlowNodes(nodes)}
          edges={buildFlowEdges(connections)}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
