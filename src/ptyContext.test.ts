import { describe, expect, it } from "vitest";
import { resolvePtyCreateContext } from "./App";

describe("resolvePtyCreateContext", () => {
  it("parses pty/agent/cwd from query parameters", () => {
    const result = resolvePtyCreateContext("?pty=CON-28&agent=MemberB&cwd=.%2F.wt%2Fcon-28-message-forwarding");

    expect(result).toEqual({
      taskId: "CON-28",
      member: "MemberB",
      cwd: "./.wt/con-28-message-forwarding",
    });
  });

  it("accepts legacy aliases and trims empty values", () => {
    const result = resolvePtyCreateContext("?taskId=CON-28&member=MemberB&cwd=%20%20");

    expect(result).toEqual({
      taskId: "CON-28",
      member: "MemberB",
      cwd: undefined,
    });
  });
});
