import type { BlockNode, MergeConflict } from "@docleus/sdk";
import { describe, expect, it } from "vitest";
import { describeBlock, editSeed, resolutionOf } from "./conflict-model.ts";

const marked: BlockNode = {
  id: "b1",
  type: "paragraph",
  v: 1,
  attrs: {},
  inline: [
    { type: "text", text: "Hello " },
    { type: "text", text: "world", marks: [{ type: "strong" }] },
  ],
  content: [{ id: "b9", type: "paragraph", v: 1, attrs: {} }],
};

const block = (
  theirs: BlockNode | undefined,
): MergeConflict & { kind: "block" } => ({
  id: "c1",
  kind: "block",
  entryId: "p1",
  blockId: "b1",
  base: undefined,
  ours: { ...marked, inline: [{ type: "text", text: "Hi" }] },
  theirs,
});

describe("conflict model", () => {
  it("describes a block by type, attributes and text", () => {
    expect(
      describeBlock({
        id: "h",
        type: "heading",
        v: 1,
        attrs: { level: 2 },
        inline: [{ type: "text", text: "Setup" }],
      }),
    ).toEqual({ label: "heading (level: 2)", text: "Setup" });
  });

  it("edits text with marks as text and other inline nodes as JSON", () => {
    expect(editSeed(block(marked))).toEqual({
      mode: "text",
      text: "Hello world",
    });
    const seed = editSeed(
      block({ ...marked, inline: [{ type: "math", attrs: { source: "x" } }] }),
    );
    expect(seed.mode).toBe("json");
    expect(JSON.parse(seed.text)).not.toHaveProperty("content");
  });

  it("keeps a side's inline nodes when its text is unchanged", () => {
    expect(resolutionOf(block(marked), "text", "Hello world")).toEqual({
      value: {
        id: "b1",
        type: "paragraph",
        v: 1,
        attrs: {},
        inline: marked.inline,
      },
    });
    expect(resolutionOf(block(marked), "text", "Hi")).toEqual({
      value: {
        id: "b1",
        type: "paragraph",
        v: 1,
        attrs: {},
        inline: [{ type: "text", text: "Hi" }],
      },
    });
  });

  it("accepts null to delete a block and rejects children", () => {
    expect(resolutionOf(block(marked), "json", "null")).toEqual({
      value: null,
    });
    expect(() =>
      resolutionOf(block(marked), "json", JSON.stringify(marked)),
    ).toThrow("Leave out content");
  });

  it("starts an edit from an earlier edit", () => {
    const conflict = block({
      ...marked,
      inline: [{ type: "text", text: "A" }],
    });
    expect(
      editSeed(conflict, {
        value: { ...marked, inline: [{ type: "text", text: "B" }] },
      }),
    ).toEqual({ mode: "text", text: "B" });
  });
});
