import { useReducer, type ChangeEvent, type FormEvent } from "react";

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
    <div className="connection-manager">
      <form className="connection-form" onSubmit={handleSubmit}>
        <label className="connection-field">
          source
          <select value={state.draft.fromId} onChange={handleDraftChange("fromId")}>
            {nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.label}
              </option>
            ))}
          </select>
        </label>

        <label className="connection-field">
          target
          <select value={state.draft.toId} onChange={handleDraftChange("toId")}>
            {nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.label}
              </option>
            ))}
          </select>
        </label>

        <label className="connection-field connection-field-wide">
          description
          <input
            type="text"
            placeholder="optional"
            value={state.draft.description}
            onChange={handleDraftChange("description")}
          />
        </label>

        <div className="connection-actions">
          <button type="submit">{submitLabel}</button>
          {state.editingId ? (
            <button type="button" onClick={() => dispatch({ type: "cancelEdit" })}>
              cancel
            </button>
          ) : null}
        </div>
      </form>

      {state.error ? (
        <p className="connection-error" role="status" aria-live="polite">
          {state.error}
        </p>
      ) : null}

      <ul className="connection-list" aria-label="connection list">
        {state.connections.map((connection) => (
          <li key={connection.id} className="connection-item">
            <div>
              <strong>{idToLabel.get(connection.fromId) ?? connection.fromId}</strong>
              <span className="connection-arrow" aria-hidden>
                →
              </span>
              <strong>{idToLabel.get(connection.toId) ?? connection.toId}</strong>
              <p className="connection-description">
                {connection.description || "no description"}
              </p>
            </div>
            <div className="connection-actions">
              <button type="button" onClick={() => dispatch({ type: "beginEdit", id: connection.id })}>
                edit
              </button>
              <button type="button" onClick={() => dispatch({ type: "remove", id: connection.id })}>
                remove
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
