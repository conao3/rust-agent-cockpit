import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  it("renders initial connections", () => {
    render(<ConnectionManager nodes={[...nodes]} />);

    expect(screen.getByTestId("connection-graph")).toBeTruthy();
    const list = screen.getByRole("list", { name: "connection list" });
    expect(within(list).getByText("task delegation")).toBeTruthy();
    expect(within(list).getByText("status updates")).toBeTruthy();
  });

  it("adds a new connection", () => {
    render(<ConnectionManager nodes={[...nodes]} />);

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "member-a" } });
    fireEvent.change(selects[1], { target: { value: "leader" } });
    fireEvent.change(screen.getByPlaceholderText("optional"), {
      target: { value: "feedback" },
    });

    fireEvent.click(screen.getByRole("button", { name: "add connection" }));

    expect(screen.getByText("feedback")).toBeTruthy();
  });

  it("edits and removes a connection", () => {
    render(<ConnectionManager nodes={[...nodes]} />);

    const statusRow = screen.getByText("status updates").closest("li");
    if (!statusRow) {
      throw new Error("connection row not found");
    }

    fireEvent.click(within(statusRow).getByRole("button", { name: "edit" }));
    fireEvent.change(screen.getByPlaceholderText("optional"), {
      target: { value: "updated status" },
    });
    fireEvent.click(screen.getByRole("button", { name: "save connection" }));

    expect(screen.getByText("updated status")).toBeTruthy();

    const updatedRow = screen.getByText("updated status").closest("li");
    if (!updatedRow) {
      throw new Error("updated row not found");
    }

    fireEvent.click(within(updatedRow).getByRole("button", { name: "remove" }));

    expect(screen.queryByText("updated status")).toBeNull();
  });

  it("prevents duplicate source-target edges", () => {
    render(<ConnectionManager nodes={[...nodes]} />);

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "leader" } });
    fireEvent.change(selects[1], { target: { value: "member-a" } });
    fireEvent.click(screen.getByRole("button", { name: "add connection" }));

    expect(screen.getByText("connection already exists")).toBeTruthy();
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
