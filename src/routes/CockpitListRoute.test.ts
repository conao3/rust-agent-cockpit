import { describe, expect, it } from "vitest";
import { buildNewCockpitDocument, filterCockpits } from "./cockpitListModel";

describe("CockpitListRoute helpers", () => {
  it("builds a valid default cockpit payload", () => {
    const now = new Date(2026, 2, 7, 10, 11, 12);
    const cockpit = buildNewCockpitDocument(now);

    expect(cockpit.id).toBe("cockpit-20260307101112");
    expect(cockpit.title).toContain("2026");
    expect(cockpit.cwd).toBe(".wt/cockpit-20260307101112");
    expect(cockpit.taskId).toBeNull();
    expect(cockpit.member).toBeNull();
  });

  it("filters cockpit rows by free text", () => {
    const rows = [
      {
        id: "cockpit-1",
        title: "Alpha",
        cwd: ".wt/cockpit-1",
        taskId: "CON-101",
        member: "MemberA",
      },
      {
        id: "cockpit-2",
        title: "Beta",
        cwd: ".wt/cockpit-2",
        taskId: null,
        member: null,
      },
    ];

    expect(filterCockpits(rows, "membera")).toEqual([rows[0]]);
    expect(filterCockpits(rows, "beta")).toEqual([rows[1]]);
    expect(filterCockpits(rows, "con-101")).toEqual([rows[0]]);
  });
});
