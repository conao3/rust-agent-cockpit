import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSettingsPanel } from "./AgentSettingsPanel";
import { agentSettingsGet, agentSettingsSave } from "../agentSettingsApi";

vi.mock("../agentSettingsApi", () => ({
  agentSettingsGet: vi.fn(),
  agentSettingsSave: vi.fn(),
}));

const getMock = vi.mocked(agentSettingsGet);
const saveMock = vi.mocked(agentSettingsSave);

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => {
  cleanup();
  getMock.mockReset();
  saveMock.mockReset();
});

describe("AgentSettingsPanel", () => {
  it("loads existing settings and saves edited values", async () => {
    getMock.mockResolvedValueOnce({
      version: 1,
      agents: [
        {
          id: "leader",
          name: "Leader",
          command: "codex",
          systemPrompt: "coordinate",
          toolRestrictions: ["git", "cargo"],
        },
      ],
    });
    saveMock.mockResolvedValueOnce({
      version: 1,
      agents: [
        {
          id: "leader",
          name: "Leader Updated",
          command: "codex --fast",
          systemPrompt: "coordinate better",
          toolRestrictions: ["git"],
        },
      ],
    });

    render(<AgentSettingsPanel cockpitId="default" />, { wrapper: Wrapper });

    await screen.findByDisplayValue("leader");

    const nameInput = screen.getByLabelText("agent 1 name");
    fireEvent.change(nameInput, { target: { value: "Leader Updated" } });
    const commandInput = screen.getByLabelText("agent 1 command");
    fireEvent.change(commandInput, { target: { value: "codex --fast" } });
    const promptInput = screen.getByLabelText("agent 1 system prompt");
    fireEvent.change(promptInput, { target: { value: "coordinate better" } });

    const toolTextarea = screen.getByLabelText("agent 1 tool restrictions");
    fireEvent.change(toolTextarea, { target: { value: "git" } });

    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledWith({
        cockpitId: "default",
        settings: {
          version: 1,
          agents: [
            {
              id: "leader",
              name: "Leader Updated",
              command: "codex --fast",
              systemPrompt: "coordinate better",
              toolRestrictions: ["git"],
            },
          ],
        },
      });
    });

    expect(getMock).toHaveBeenCalledWith({ cockpitId: "default" });
    expect(await screen.findByText("settings saved")).toBeTruthy();
  });

  it("allows adding and removing agent rows", async () => {
    getMock.mockResolvedValueOnce({ version: 1, agents: [] });
    saveMock.mockResolvedValueOnce({
      version: 1,
      agents: [
        {
          id: "agent-1",
          name: "Member A",
          command: "codex",
          systemPrompt: null,
          toolRestrictions: [],
        },
      ],
    });

    render(<AgentSettingsPanel cockpitId="default" />, { wrapper: Wrapper });

    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
    await screen.findByText("agents: 0");
    fireEvent.click(screen.getByRole("button", { name: "add agent" }));

    await screen.findByLabelText("agent 1 id");
    fireEvent.change(screen.getByLabelText("agent 1 id"), { target: { value: "agent-1" } });
    fireEvent.change(screen.getByLabelText("agent 1 name"), { target: { value: "Member A" } });

    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));

    const row = screen.getByText("agent 1").closest("article");
    expect(row).toBeTruthy();
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "remove" }));
    expect(screen.queryByText("agent 1")).toBeNull();
  });

  it("shows backend error on load failure", async () => {
    getMock.mockRejectedValueOnce(new Error("load failed"));

    render(<AgentSettingsPanel cockpitId="default" />, { wrapper: Wrapper });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("load failed");
  });
});
