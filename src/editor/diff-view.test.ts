// @vitest-environment happy-dom
import type { BlockNode } from "@docleus/sdk";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { EntryChange } from "../shared/index.ts";
import { PageDiff } from "./diff-view.tsx";
import { createTestDom, type TestDom } from "./test-dom.ts";

const cell = (id: string, text: string): BlockNode => ({
  id,
  type: "commonmark.table-cell",
  v: 1,
  attrs: {},
  inline: [{ type: "text", text }],
});
const row = (id: string, ...cells: BlockNode[]): BlockNode => ({
  id,
  type: "commonmark.table-row",
  v: 1,
  attrs: {},
  content: cells,
});
const table = (hotel: string): BlockNode => ({
  id: "t",
  type: "commonmark.table",
  v: 1,
  attrs: { align: [null, null] },
  content: [
    row("r0", cell("c00", "Expense"), cell("c01", "Notes")),
    row("r1", cell("c10", "Hotel"), cell("c11", hotel)),
  ],
});
const doc = (...content: BlockNode[]): BlockNode => ({
  id: "root",
  type: "doc",
  v: 1,
  attrs: {},
  content,
});

function change(before: BlockNode, after: BlockNode): EntryChange {
  return { entryId: "page", kind: "changed", title: "Travel", before, after };
}

let dom: TestDom;
afterEach(async () => {
  await dom.dispose();
});

describe("PageDiff", () => {
  it("shows a changed table as a table and marks only the edited cell", async () => {
    dom = createTestDom();
    await dom.render(
      createElement(PageDiff, {
        change: change(
          doc(table("$300 in New York")),
          doc(table("$320 in New York")),
        ),
        isSplit: false,
      }),
    );
    const text = dom.container.textContent ?? "";
    expect(text).not.toContain("commonmark.table");
    const tables = dom.container.querySelectorAll("table");
    expect(tables).toHaveLength(2);
    const [before, after] = [...tables];
    expect(before?.querySelectorAll("tr")).toHaveLength(2);
    expect(
      [...(before?.querySelectorAll("del") ?? [])].map((d) => d.textContent),
    ).toEqual(["$300"]);
    expect(
      [...(after?.querySelectorAll("ins") ?? [])].map((d) => d.textContent),
    ).toEqual(["$320"]);
    expect(after?.querySelector("tr")?.textContent).toBe("ExpenseNotes");
  });

  it("names an unknown block type in words", async () => {
    dom = createTestDom();
    const block: BlockNode = {
      id: "x",
      type: "acme.api-endpoint",
      v: 1,
      attrs: {},
      inline: [{ type: "text", text: "GET /orders" }],
    };
    await dom.render(
      createElement(PageDiff, {
        change: change(doc(), doc(block)),
        isSplit: false,
      }),
    );
    expect(dom.container.textContent).toContain("Api endpoint");
    expect(dom.container.textContent).not.toContain("acme.api-endpoint");
  });

  it("marks rows with + and − only, without line numbers", async () => {
    dom = createTestDom();
    await dom.render(
      createElement(PageDiff, {
        change: change(doc(table("a")), doc(table("b"))),
        isSplit: false,
      }),
    );
    expect(dom.container.querySelectorAll(".ln")).toHaveLength(0);
    expect(
      [...dom.container.querySelectorAll(".sg")].map(
        (sign) => sign.textContent,
      ),
    ).toEqual(["−", "+"]);
  });
});
