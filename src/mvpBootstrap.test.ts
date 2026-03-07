import { describe, expect, it } from "vitest";
import { buildCockpitSearch } from "./mvpBootstrap";

describe("buildCockpitSearch", () => {
  it("builds query with pty/agent/cwd", () => {
    expect(
      buildCockpitSearch({
        taskId: "CON-31",
        member: "MemberA",
        cwd: "./.wt/con-31-mvp",
      }),
    ).toBe("?pty=CON-31&agent=MemberA&cwd=.%2F.wt%2Fcon-31-mvp");
  });

  it("omits blank values", () => {
    expect(
      buildCockpitSearch({
        taskId: "  ",
        member: "MemberB",
        cwd: "",
      }),
    ).toBe("?agent=MemberB");
  });
});
