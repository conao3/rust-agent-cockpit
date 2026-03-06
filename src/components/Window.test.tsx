import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Window } from "./Window";

describe("Window", () => {
  it("renders title, status, and content", () => {
    render(
      <Window title="PTY Terminal" status="connected">
        <div>terminal content</div>
      </Window>,
    );

    expect(screen.getByRole("heading", { name: "PTY Terminal" })).toBeTruthy();
    expect(screen.getByText("connected")).toBeTruthy();
    expect(screen.getByText("terminal content")).toBeTruthy();
  });
});
