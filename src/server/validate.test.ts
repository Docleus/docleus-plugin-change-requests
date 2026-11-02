import { describe, expect, it } from "vitest";
import {
  DEFAULT_TITLE,
  MAX_REQUIRED_APPROVALS,
  MAX_TITLE_LENGTH,
  parseCreateBody,
  parseNumber,
  parsePatchBody,
  parseResolutionsBody,
  parseStatusFilter,
  parseWorkflowBody,
  readJson,
  toResolution,
  toWorkflow,
} from "./validate.ts";

const invalid = { code: "change-requests/invalid-request" };

describe("readJson", () => {
  it("reads an empty body as an empty object", async () => {
    await expect(
      readJson(new Request("http://x", { method: "POST" })),
    ).resolves.toEqual({});
  });

  it("rejects malformed JSON", async () => {
    await expect(
      readJson(new Request("http://x", { method: "POST", body: "{" })),
    ).rejects.toMatchObject(invalid);
  });
});

describe("parseCreateBody", () => {
  it("defaults the title and trims a given one", () => {
    expect(parseCreateBody({})).toEqual({ title: DEFAULT_TITLE });
    expect(parseCreateBody({ title: "  Fix typo " })).toEqual({
      title: "Fix typo",
    });
  });

  it("rejects unknown fields, blank and long titles", () => {
    expect(() => parseCreateBody({ other: 1 })).toThrow(/unknown field/);
    expect(() => parseCreateBody({ title: "   " })).toThrow(/empty/);
    expect(() =>
      parseCreateBody({ title: "x".repeat(MAX_TITLE_LENGTH + 1) }),
    ).toThrow(/longer/);
    expect(() => parseCreateBody([])).toThrow(/object/);
  });
});

describe("parsePatchBody", () => {
  it("keeps only the given fields", () => {
    expect(parsePatchBody({ description: "why" })).toEqual({
      description: "why",
    });
    expect(parsePatchBody({ title: "T", description: "" })).toEqual({
      title: "T",
      description: "",
    });
  });

  it("rejects a non-string description", () => {
    expect(() => parsePatchBody({ description: 1 })).toThrow(/string/);
    expect(() => parsePatchBody({ title: 1 })).toThrow(
      /title must be a string/,
    );
    expect(() => parsePatchBody({ title: " " })).toThrow(/empty/);
  });
});

describe("resolutions", () => {
  it("accepts take and value resolutions", () => {
    expect(toResolution({ take: "ours" })).toEqual({ take: "ours" });
    expect(toResolution({ value: null })).toEqual({ value: null });
    expect(toResolution({ take: "mine" })).toBeUndefined();
    expect(toResolution({ take: "ours", value: 1 })).toBeUndefined();
    expect(toResolution({})).toBeUndefined();
    expect(toResolution([])).toBeUndefined();
  });

  it("parses a resolutions body", () => {
    expect(
      parseResolutionsBody({
        resolutions: { "entry:a:title": { value: "T" } },
      }),
    ).toEqual({ "entry:a:title": { value: "T" } });
    expect(() => parseResolutionsBody({ resolutions: [] })).toThrow(/object/);
    expect(() =>
      parseResolutionsBody({ resolutions: { a: { take: "x" } } }),
    ).toThrow(/resolution "a"/);
    expect(() =>
      parseResolutionsBody({ resolutions: { "": { take: "ours" } } }),
    ).toThrow(/invalid conflict id/);
    expect(() => parseResolutionsBody({ other: {} })).toThrow(
      /unknown field "other"/,
    );
  });
});

describe("workflow", () => {
  it("validates settings", () => {
    expect(toWorkflow({ mode: "direct", requiredApprovals: 0 })).toEqual({
      mode: "direct",
      requiredApprovals: 0,
    });
    expect(
      toWorkflow({ mode: "change-requests", requiredApprovals: 1.5 }),
    ).toBeUndefined();
    expect(
      toWorkflow({
        mode: "change-requests",
        requiredApprovals: MAX_REQUIRED_APPROVALS + 1,
      }),
    ).toBeUndefined();
    expect(toWorkflow({ mode: "other", requiredApprovals: 0 })).toBeUndefined();
  });

  it("parses a workflow body", () => {
    expect(parseWorkflowBody({ workflow: null })).toBeNull();
    expect(
      parseWorkflowBody({
        workflow: { mode: "change-requests", requiredApprovals: 2 },
      }),
    ).toEqual({ mode: "change-requests", requiredApprovals: 2 });
    expect(() =>
      parseWorkflowBody({
        workflow: { mode: "direct", requiredApprovals: 0, level: "org" },
      }),
    ).toThrow(/unknown field "level"/);
    expect(() => parseWorkflowBody({})).toThrow(/workflow must be/);
    expect(() =>
      parseWorkflowBody({
        workflow: { mode: "direct", requiredApprovals: -1 },
      }),
    ).toThrow(/workflow must be/);
    expect(() => parseWorkflowBody([])).toThrow(/body must be an object/);
  });
});

describe("parseStatusFilter", () => {
  it("defaults to active and rejects unknown statuses", () => {
    expect(parseStatusFilter(null)).toBe("active");
    expect(parseStatusFilter("")).toBe("active");
    expect(parseStatusFilter("merged")).toBe("merged");
    expect(() => parseStatusFilter("pending")).toThrow(/status must be/);
  });
});

describe("parseNumber", () => {
  it("accepts positive integers and treats anything else as not found", () => {
    expect(parseNumber("12")).toBe(12);
    for (const value of ["0", "01", "-1", "1.5", "abc", undefined]) {
      expect(() => parseNumber(value)).toThrow(
        expect.objectContaining({ code: "change-requests/not-found" }),
      );
    }
  });
});
