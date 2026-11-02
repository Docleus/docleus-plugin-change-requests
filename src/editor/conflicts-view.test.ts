// @vitest-environment happy-dom
import { createElement } from "react";
import type { BlockNode, MergeConflict } from "@docleus/sdk";
import { afterEach, describe, expect, it } from "vitest";
import type { Resolutions } from "./api.ts";
import { ConflictsView } from "./conflicts-view.tsx";
import { createTestDom, detailFixture, type TestDom } from "./test-dom.ts";

const SPACE = "/api/orgs/o1/spaces/s1";
const CR = `${SPACE}/change-requests/4`;

const paragraph = (text: string): BlockNode => ({
  id: "b1",
  type: "paragraph",
  v: 1,
  attrs: {},
  inline: [{ type: "text", text }],
});

const BLOCK: MergeConflict = {
  id: "c-block",
  kind: "block",
  entryId: "p1",
  blockId: "b1",
  base: paragraph("Hello"),
  ours: paragraph("Hello from main"),
  theirs: paragraph("Hello from the change request"),
};

const TITLE: MergeConflict = {
  id: "c-title",
  kind: "entry",
  entryId: "p1",
  field: "title",
  base: "Intro",
  ours: "Introduction",
  theirs: "Getting started",
};

const code = (source: string): BlockNode => ({
  id: "b2",
  type: "code",
  v: 1,
  attrs: { language: "ts", source },
});

const CODE: MergeConflict = {
  id: "c-code",
  kind: "block",
  entryId: "p1",
  blockId: "b2",
  base: code("a"),
  ours: code("b"),
  theirs: code("c"),
};

let dom: TestDom;
afterEach(() => dom.dispose());

async function renderConflicts(
  conflicts: MergeConflict[],
  resolutions: Resolutions = {},
) {
  dom = createTestDom();
  dom.route("GET", CR, () => ({
    body: detailFixture(
      { number: 4, status: "open" },
      { conflicts: conflicts.length, canMerge: false, isBehind: true },
    ),
  }));
  dom.route("GET", `${SPACE}?branch=main`, () => ({
    body: { pages: [{ id: "p1", title: "Intro" }] },
  }));
  dom.route("GET", `${SPACE}?branch=cr%2F4`, () => ({
    body: { pages: [{ id: "p1", title: "Intro" }] },
  }));
  dom.route("GET", `${CR}/conflicts`, () => ({
    body: { main: "r2", conflicts, resolutions },
  }));
  await dom.render(
    createElement(ConflictsView, {
      api: dom.api,
      space: { orgId: "o1", spaceId: "s1" },
      number: 4,
    }),
  );
  await dom.waitFor(() => dom.container.querySelector(".cr-conflict"));
}

const card = (index = 0) => {
  const found =
    dom.container.querySelectorAll<HTMLElement>(".cr-conflict")[index];
  if (!found) throw new Error(`no conflict card ${index}`);
  return found;
};

async function press(name: string, within?: ParentNode) {
  const button = dom.button(name, within);
  if (!button) throw new Error(`no button "${name}"; ${dom.buttons(within)}`);
  await dom.click(button);
}

const textarea = (within: ParentNode) => {
  const found = within.querySelector("textarea");
  if (!found) throw new Error("no textarea");
  return found;
};

describe("conflicts view", () => {
  it("shows both versions of a block as readable text with its type", async () => {
    await renderConflicts([BLOCK]);
    const conflict = card();
    expect(conflict.querySelector("h2")?.textContent).toBe(
      "Page “Intro”: block (paragraph)",
    );
    const sides = [...conflict.querySelectorAll(".cr-side")].map((side) => ({
      heading: side.querySelector("h3")?.textContent,
      type: side.querySelector(".cr-block-type")?.textContent,
      text: side.querySelector(".cr-block-text")?.textContent,
    }));
    expect(sides).toEqual([
      { heading: "Main", type: "paragraph", text: "Hello from main" },
      {
        heading: "Change request",
        type: "paragraph",
        text: "Hello from the change request",
      },
    ]);
    expect(dom.container.textContent).toContain("1 of 1 conflicts unresolved.");
    expect(dom.button("Update from main")?.disabled).toBe(true);
  });

  it("picks a side, saves it, then allows updating from main", async () => {
    await renderConflicts([BLOCK, TITLE]);
    await press("Use main", card(0));
    await press("Use change request", card(1));
    expect(card(0).querySelector(".cr-resolved")?.textContent).toBe(
      "Resolved: using main (not saved yet)",
    );
    expect(dom.button("Use main", card(0))?.getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(card(1).querySelectorAll(".cr-side")[1]?.className).toContain(
      "is-chosen",
    );
    expect(dom.button("Update from main")?.disabled).toBe(true);

    const resolutions = {
      "c-block": { take: "ours" },
      "c-title": { take: "theirs" },
    };
    dom.route("PUT", `${CR}/resolutions`, () => ({
      body: { main: "r2", conflicts: [], resolutions },
    }));
    await press("Save resolutions");
    expect(dom.calls.find((c) => c.method === "PUT")?.body).toEqual({
      resolutions,
    });
    expect(card(0).querySelector(".cr-resolved")?.textContent).toBe(
      "Resolved: using main",
    );
    expect(dom.container.textContent).toContain(
      "Every conflict has a resolution.",
    );

    dom.route("POST", `${CR}/rebase`, () => ({ body: {} }));
    await press("Update from main");
    expect(dom.calls.at(-1)).toMatchObject({
      method: "POST",
      path: `${CR}/rebase`,
    });
    expect(window.location.pathname + window.location.search).toBe(
      "/orgs/o1/spaces/s1?view=change-requests.requests&cr=4",
    );
  });

  it("undoes a choice", async () => {
    await renderConflicts([BLOCK]);
    await press("Use change request", card());
    await press("Undo", card());
    expect(card().querySelector(".cr-resolved")).toBeNull();
    expect(dom.button("Save resolutions")?.disabled).toBe(true);
  });

  it("edits a text block's text", async () => {
    await renderConflicts([BLOCK]);
    await press("Edit", card());
    const input = textarea(card());
    expect(input.value).toBe("Hello from the change request");
    expect(card().querySelector("label")?.textContent).toContain("Text");
    await dom.type(input, "Hello from both");
    await press("Use this version", card());
    expect(card().querySelector(".cr-resolved")?.textContent).toBe(
      "Resolved: edited (not saved yet)",
    );

    dom.route("PUT", `${CR}/resolutions`, (call) => ({
      body: {
        main: "r2",
        conflicts: [],
        resolutions: (call.body as { resolutions: Resolutions }).resolutions,
      },
    }));
    await press("Save resolutions");
    expect(dom.calls.find((c) => c.method === "PUT")?.body).toEqual({
      resolutions: {
        "c-block": { value: paragraph("Hello from both") },
      },
    });
  });

  it("edits a title as text", async () => {
    await renderConflicts([TITLE]);
    await press("Edit", card());
    const input = textarea(card());
    expect(input.value).toBe("Getting started");
    await dom.type(input, "Start here");
    await press("Use this version", card());
    dom.route("PUT", `${CR}/resolutions`, () => ({
      body: { main: "r2", conflicts: [], resolutions: {} },
    }));
    await press("Save resolutions");
    expect(dom.calls.find((c) => c.method === "PUT")?.body).toEqual({
      resolutions: { "c-title": { value: "Start here" } },
    });
  });

  it("edits other blocks as validated JSON", async () => {
    await renderConflicts([CODE]);
    expect(card().querySelector(".cr-block-type")?.textContent).toBe(
      "code (language: ts, source: b)",
    );
    await press("Edit", card());
    const input = textarea(card());
    expect(card().querySelector("label")?.textContent).toContain(
      "Value (JSON)",
    );
    expect(JSON.parse(input.value)).toEqual(code("c"));

    await dom.type(input, "{ not json");
    await press("Use this version", card());
    expect(card().querySelector('[role="alert"]')?.textContent).toBe(
      "The value is not valid JSON.",
    );
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(card().querySelector(".cr-resolved")).toBeNull();

    await dom.type(input, JSON.stringify({ ...code("d"), id: "other" }));
    await press("Use this version", card());
    expect(card().querySelector('[role="alert"]')?.textContent).toBe(
      'The block id must stay "b2".',
    );

    await dom.type(input, JSON.stringify(code("d")));
    await press("Use this version", card());
    expect(card().querySelector('[role="alert"]')).toBeNull();
    expect(card().querySelector(".cr-resolved")?.textContent).toBe(
      "Resolved: edited (not saved yet)",
    );
  });

  it("keeps saved resolutions and shows a failed save as an alert", async () => {
    await renderConflicts([BLOCK], { "c-block": { take: "theirs" } });
    expect(card().querySelector(".cr-resolved")?.textContent).toBe(
      "Resolved: using the change request",
    );
    await press("Use main", card());
    dom.route("PUT", `${CR}/resolutions`, () => ({
      status: 400,
      body: { code: "content/invalid-resolution", message: "bad resolution" },
    }));
    await press("Save resolutions");
    expect(dom.container.querySelector('[role="alert"]')?.textContent).toBe(
      "bad resolution",
    );
  });
});
