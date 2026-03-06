import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Window } from "./Window";

afterEach(() => {
  cleanup();
});

describe("Window", () => {
  it("renders title, status, and content", () => {
    render(
      <Window x={10} y={20} width={400} height={320} zIndex={3} title="PTY Terminal" status="connected">
        <div>terminal content</div>
      </Window>,
    );

    expect(screen.getByRole("heading", { name: "PTY Terminal" })).toBeTruthy();
    expect(screen.getByText("connected")).toBeTruthy();
    expect(screen.getByText("terminal content")).toBeTruthy();
  });

  it("activates on mouse down", () => {
    let activated = 0;

    render(
      <Window
        x={10}
        y={20}
        width={400}
        height={320}
        zIndex={3}
        title="PTY Terminal"
        onActivate={() => {
          activated += 1;
        }}
      >
        <div>terminal content</div>
      </Window>,
    );

    fireEvent.mouseDown(screen.getByRole("heading", { name: "PTY Terminal" }));
    expect(activated).toBe(1);
  });

  it("emits move and resize updates", () => {
    const moved: Array<[number, number]> = [];
    const resized: Array<[number, number]> = [];

    render(
      <Window
        x={20}
        y={30}
        width={420}
        height={300}
        zIndex={1}
        title="Connections"
        onMove={(x, y) => moved.push([x, y])}
        onResize={(width, height) => resized.push([width, height])}
      >
        <div>content</div>
      </Window>,
    );

    fireEvent.mouseDown(screen.getByRole("heading", { name: "Connections" }), {
      clientX: 100,
      clientY: 110,
    });
    fireEvent.mouseMove(window, { clientX: 140, clientY: 170 });
    fireEvent.mouseUp(window);

    expect(moved[moved.length - 1]).toEqual([60, 90]);

    fireEvent.mouseDown(screen.getByRole("button", { name: "Connections resize" }), {
      clientX: 200,
      clientY: 210,
    });
    fireEvent.mouseMove(window, { clientX: 260, clientY: 250 });
    fireEvent.mouseUp(window);

    expect(resized[resized.length - 1]).toEqual([480, 340]);
  });
});
