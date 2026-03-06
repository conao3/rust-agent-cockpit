import { describe, expect, it } from "vitest";
import { resolvePtyCreateContext } from "./App";

describe("resolvePtyCreateContext", () => {
  it("parses task/member/cwd from query parameters", () => {
    const result = resolvePtyCreateContext(
      "?task_id=CON-28&member=MemberB&cwd=.%2F.wt%2Fcon-28-message-forwarding",
    );

    expect(result).toEqual({
      taskId: "CON-28",
      member: "MemberB",
      cwd: "./.wt/con-28-message-forwarding",
    });
  });

  it("accepts camelCase aliases and trims empty values", () => {
    const result = resolvePtyCreateContext("?taskId=CON-28&agent=MemberB&cwd=%20%20");

    expect(result).toEqual({
      taskId: "CON-28",
      member: "MemberB",
      cwd: undefined,
    });
  });
});
