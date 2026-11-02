import type { EntryContent } from "@docleus/sdk";
import { describe, expect, it } from "vitest";
import {
  diffEntrySets,
  entryChanges,
  isEmptyDiff,
  isEqualValue,
  toEntrySet,
} from "./diff.ts";

function page(title: string, patch: Partial<EntryContent> = {}): EntryContent {
  return {
    type: "page",
    title,
    parent: undefined,
    order: 0,
    fields: {},
    ...patch,
  };
}

describe("isEqualValue", () => {
  it("compares nested values structurally", () => {
    expect(isEqualValue({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(isEqualValue({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(
      false,
    );
    expect(isEqualValue([1], { 0: 1 })).toBe(false);
    expect(isEqualValue(null, {})).toBe(false);
  });

  it("treats a key holding undefined as absent", () => {
    expect(isEqualValue({ a: 1, b: undefined }, { a: 1 })).toBe(true);
  });
});

describe("toEntrySet", () => {
  it("keys entries by id", () => {
    const set = toEntrySet([{ id: "a", ...page("A") }]);
    expect(set).toEqual({ a: page("A") });
  });
});

describe("diffEntrySets", () => {
  it("puts added and changed entries and removes missing ones", () => {
    const from = { a: page("A"), b: page("B"), c: page("C") };
    const to = { a: page("A"), b: page("B2"), d: page("D") };
    const diff = diffEntrySets(from, to);
    expect(diff).toEqual({
      put: { b: page("B2"), d: page("D") },
      remove: ["c"],
    });
    expect(isEmptyDiff(diff)).toBe(false);
  });

  it("is empty for equal sets", () => {
    expect(isEmptyDiff(diffEntrySets({ a: page("A") }, { a: page("A") }))).toBe(
      true,
    );
  });
});

describe("entryChanges", () => {
  it("classifies added, changed, moved and removed entries", () => {
    const base = {
      a: page("A"),
      b: page("B"),
      c: page("C"),
      e: page("E"),
    };
    const head = {
      a: page("A"),
      b: page("B", { fields: { x: 1 } }),
      c: page("C", { parent: "a", order: 2 }),
      d: page("D"),
    };
    expect(entryChanges(base, head)).toEqual([
      { entryId: "b", title: "B", kind: "changed" },
      { entryId: "c", title: "C", kind: "moved" },
      { entryId: "d", title: "D", kind: "added" },
      { entryId: "e", title: "E", kind: "removed" },
    ]);
  });

  it("skips entries the caller knows are unchanged", () => {
    const base = { a: page("A") };
    const head = { a: page("A2") };
    expect(entryChanges(base, head, (id) => id === "a")).toEqual([]);
  });
});
