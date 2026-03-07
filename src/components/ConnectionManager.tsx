import { useReducer, type ChangeEvent, type FormEvent } from "react";
import { Button, Input, Label, TextField } from "react-aria-components";
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

type DraftConnection = {
  fromId: string;
  toId: string;
  description: string;
};

type State = {
  connections: Connection[];
  draft: DraftConnection;
  editingId: string | null;
  error: string | null;
};

type Action =
  | { type: "draftChanged"; field: keyof DraftConnection; value: string }
  | { type: "beginEdit"; id: string }
  | { type: "cancelEdit" }
  | { type: "remove"; id: string }
  | { type: "submit"; idSeed: number }
  | { type: "clearError" };

type ConnectionManagerProps = {
  nodes: GraphNode[];
};

const initialConnections: Connection[] = [
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

const initialDraft: DraftConnection = {
  fromId: "leader",
  toId: "member-a",
  description: "",
};

const initialState: State = {
  connections: initialConnections,
  draft: initialDraft,
  editingId: null,
  error: null,
};

const nodePositions = [
  { x: 160, y: 40 },
  { x: 40, y: 220 },
  { x: 280, y: 220 },
];

const fallbackNodePosition = { x: 160, y: 130 };

const controlClassName =
  "rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 outline-none transition focus:border-cyan-300";

const buttonClassName =
  "rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 outline-none transition hover:border-cyan-300 hover:text-cyan-100 focus-visible:border-cyan-300";

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

export function buildFlowEdges(connections: Connection[]): Edge[] {
  return connections.map((connection) => ({
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

function validateDraft(state: State): string | null {
  const { fromId, toId } = state.draft;

  if (!fromId || !toId) {
    return "source and target are required";
  }

  if (fromId === toId) {
    return "source and target must be different";
  }

  const duplicate = state.connections.some((connection) => {
    if (state.editingId && connection.id === state.editingId) {
      return false;
    }
    return connection.fromId === fromId && connection.toId === toId;
  });

  if (duplicate) {
    return "connection already exists";
  }

  return null;
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "draftChanged": {
      return {
        ...state,
        draft: {
          ...state.draft,
          [action.field]: action.value,
        },
      };
    }
    case "beginEdit": {
      const target = state.connections.find((connection) => connection.id === action.id);
      if (!target) {
        return state;
      }
      return {
        ...state,
        editingId: target.id,
        draft: {
          fromId: target.fromId,
          toId: target.toId,
          description: target.description,
        },
        error: null,
      };
    }
    case "cancelEdit": {
      return {
        ...state,
        editingId: null,
        draft: initialDraft,
        error: null,
      };
    }
    case "remove": {
      return {
        ...state,
        connections: state.connections.filter((connection) => connection.id !== action.id),
        editingId: state.editingId === action.id ? null : state.editingId,
        draft: state.editingId === action.id ? initialDraft : state.draft,
        error: null,
      };
    }
    case "submit": {
      const validation = validateDraft(state);
      if (validation) {
        return {
          ...state,
          error: validation,
        };
      }

      if (state.editingId) {
        return {
          ...state,
          connections: state.connections.map((connection) =>
            connection.id === state.editingId
              ? {
                  ...connection,
                  fromId: state.draft.fromId,
                  toId: state.draft.toId,
                  description: state.draft.description.trim(),
                }
              : connection,
          ),
          editingId: null,
          draft: initialDraft,
          error: null,
        };
      }

      const nextConnection: Connection = {
        id: `conn-${action.idSeed}`,
        fromId: state.draft.fromId,
        toId: state.draft.toId,
        description: state.draft.description.trim(),
      };

      return {
        ...state,
        connections: [...state.connections, nextConnection],
        editingId: null,
        draft: initialDraft,
        error: null,
      };
    }
    case "clearError": {
      return {
        ...state,
        error: null,
      };
    }
    default:
      return state;
  }
}

export function ConnectionManager({ nodes }: ConnectionManagerProps) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const idToLabel = new Map(nodes.map((node) => [node.id, node.label] as const));
  const submitLabel = state.editingId ? "save connection" : "add connection";
  const flowNodes = buildFlowNodes(nodes);
  const flowEdges = buildFlowEdges(state.connections);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    dispatch({ type: "submit", idSeed: Date.now() });
  };

  const handleDraftChange =
    (field: keyof DraftConnection) =>
    (event: ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
      dispatch({ type: "draftChanged", field, value: event.target.value });
      if (state.error) {
        dispatch({ type: "clearError" });
      }
    };

  return (
    <div className="flex h-full flex-col gap-2.5 p-2.5">
      <div
        className="connection-graph h-[220px] overflow-hidden rounded-lg border border-slate-800 bg-slate-950"
        aria-label="connection graph"
        data-testid="connection-graph"
      >
        <ReactFlow
          fitView
          nodes={flowNodes}
          edges={flowEdges}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      <form className="grid grid-cols-2 items-end gap-2" onSubmit={handleSubmit}>
        <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.03em] text-slate-300">
          source
          <select value={state.draft.fromId} onChange={handleDraftChange("fromId")} className={controlClassName}>
            {nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.03em] text-slate-300">
          target
          <select value={state.draft.toId} onChange={handleDraftChange("toId")} className={controlClassName}>
            {nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.label}
              </option>
            ))}
          </select>
        </label>

        <TextField className="col-span-full flex flex-col gap-1">
          <Label className="text-xs uppercase tracking-[0.03em] text-slate-300">description</Label>
          <Input
            type="text"
            placeholder="optional"
            value={state.draft.description}
            onChange={handleDraftChange("description")}
            className={controlClassName}
          />
        </TextField>

        <div className="flex gap-2">
          <Button type="submit" className={buttonClassName}>
            {submitLabel}
          </Button>
          {state.editingId ? (
            <Button type="button" className={buttonClassName} onPress={() => dispatch({ type: "cancelEdit" })}>
              cancel
            </Button>
          ) : null}
        </div>
      </form>

      {state.error ? (
        <div className="m-0 text-sm text-red-300" role="status" aria-live="polite">
          {state.error}
        </div>
      ) : null}

      <ul className="m-0 flex list-none flex-col gap-2 overflow-auto p-0" aria-label="connection list">
        {state.connections.map((connection) => (
          <li
            key={connection.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 p-2"
          >
            <div>
              <strong>{idToLabel.get(connection.fromId) ?? connection.fromId}</strong>
              <span className="mx-1.5 text-slate-400" aria-hidden>
                →
              </span>
              <strong>{idToLabel.get(connection.toId) ?? connection.toId}</strong>
              <div className="m-0 mt-1 text-xs text-slate-400">{connection.description || "no description"}</div>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                className={buttonClassName}
                onPress={() => dispatch({ type: "beginEdit", id: connection.id })}
              >
                edit
              </Button>
              <Button
                type="button"
                className={buttonClassName}
                onPress={() => dispatch({ type: "remove", id: connection.id })}
              >
                remove
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
