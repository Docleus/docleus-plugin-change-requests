import { describe, expect, it } from "vitest";
import type { ChangeRequest } from "../shared/index.ts";
import { isMergeAllowed } from "./operations.ts";

function changeRequest(
  status: ChangeRequest["status"],
  approvals: number,
): ChangeRequest {
  return {
    spaceId: "s",
    number: 1,
    title: "T",
    description: "",
    status,
    author: "u",
    authorName: "U",
    branch: "cr/1",
    createdAt: 0,
    updatedAt: 0,
    mergedAt: undefined,
    mergedBy: undefined,
    mergedRevision: undefined,
    approvals: Array.from({ length: approvals }, (_, i) => ({
      userId: `r${i}`,
      name: `R${i}`,
      at: 0,
    })),
  };
}

describe("isMergeAllowed", () => {
  it("allows active change requests when no approvals are required", () => {
    expect(isMergeAllowed(changeRequest("draft", 0), 0)).toBe(true);
    expect(isMergeAllowed(changeRequest("open", 0), 0)).toBe(true);
    expect(isMergeAllowed(changeRequest("merged", 0), 0)).toBe(false);
    expect(isMergeAllowed(changeRequest("closed", 0), 0)).toBe(false);
  });

  it("requires an open change request with enough approvals", () => {
    expect(isMergeAllowed(changeRequest("draft", 5), 2)).toBe(false);
    expect(isMergeAllowed(changeRequest("open", 1), 2)).toBe(false);
    expect(isMergeAllowed(changeRequest("open", 2), 2)).toBe(true);
  });
});
