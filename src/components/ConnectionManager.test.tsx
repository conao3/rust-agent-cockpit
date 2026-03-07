import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionManager, buildFlowEdges } from "./ConnectionManager";

vi.mock("reactflow", () => ({
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div data-testid="reactflow-root">{children}</div>,
  Background: () => null,
  Controls: () => null,
  MarkerType: {
    ArrowClosed: "arrowclosed",
  },
}));

const nodes = [
  { id: "leader", label: "Leader" },
  { id: "member-a", label: "Member A" },
  { id: "member-b", label: "Member B" },
] as const;

afterEach(() => {
  cleanup();
});

describe("ConnectionManager", () => {
  it("renders the connection graph", () => {
    render(<ConnectionManager nodes={[...nodes]} />);

    expect(screen.getByTestId("connection-graph")).toBeTruthy();
  });

  it("maps connections into directional flow edges", () => {
    const edges = buildFlowEdges([
      {
        id: "conn-3",
        fromId: "member-a",
        toId: "leader",
        description: "feedback",
      },
    ]);

    expect(edges).toEqual([
      expect.objectContaining({
        id: "conn-3",
        source: "member-a",
        target: "leader",
        label: "feedback",
        animated: true,
      }),
    ]);
  });
});
