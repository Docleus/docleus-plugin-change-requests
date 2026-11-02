import type { BlockNode } from "@docleus/sdk";
import { describe, expect, it } from "vitest";
import { countRows, diffBlocks, diffWords, foldRows } from "./block-diff.ts";

const p = (id: string, text: string): BlockNode => ({
  id,
  type: "paragraph",
  v: 1,
  attrs: {},
  inline: [{ type: "text", text }],
});
const doc = (...content: BlockNode[]): BlockNode => ({
  id: "root",
  type: "doc",
  v: 1,
  attrs: {},
  content,
});

describe("block diff", () => {
  it("matches blocks by id and marks added, removed and changed ones", () => {
    const rows = diffBlocks(
      doc(p("a", "Keep"), p("b", "Old words here"), p("c", "Gone")),
      doc(p("a", "Keep"), p("b", "New words here"), p("d", "Added")),
    );
    // A removed block with nothing after it in the base is placed last.
    expect(rows.map((row) => row.kind)).toEqual([
      "same",
      "change",
      "add",
      "del",
    ]);
    expect(countRows(rows)).toEqual({ added: 2, removed: 2 });
    const change = rows[1];
    if (change?.kind !== "change") throw new Error("expected a change");
    expect(change.removed).toEqual([
      { text: "Old", kind: "del" },
      { text: " words here", kind: "same" },
    ]);
    expect(change.added[0]).toEqual({ text: "New", kind: "ins" });
  });

  it("treats a page without a base as all added and skips empty paragraphs", () => {
    const rows = diffBlocks(undefined, doc(p("a", "One"), p("b", "")));
    expect(rows).toEqual([{ kind: "add", after: 1, block: p("a", "One") }]);
  });

  it("keeps block ids out of the comparison", () => {
    const before = doc({ ...p("a", "Same"), v: 1 });
    const after = doc({ ...p("a", "Same"), v: 2 });
    expect(diffBlocks(before, after).map((row) => row.kind)).toEqual(["same"]);
  });

  it("diffs words with their spacing", () => {
    const [removed, added] = diffWords("a b c", "a x c");
    expect(removed.map((w) => w.kind)).toEqual(["same", "del", "same"]);
    expect(added.map((w) => w.text).join("")).toBe("a x c");
  });

  it("folds long unchanged runs but keeps one block around each change", () => {
    const same = ["a", "b", "c", "d", "e"].map((id) => p(id, id));
    const rows = diffBlocks(doc(...same), doc(...same, p("z", "new")));
    const folded = foldRows(rows, () => false);
    expect(
      folded.map((item) =>
        item.kind === "fold" ? `fold ${item.count}` : item.row.kind,
      ),
    ).toEqual(["fold 4", "same", "add"]);
    expect(foldRows(rows, () => true)).toHaveLength(6);
  });
});
