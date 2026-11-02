// @vitest-environment happy-dom
import type { SpaceBarProps } from "@docleus/sdk";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBar, createDraftFinder } from "./edit-mode.tsx";
import { createLiveChanges } from "./live.ts";
import { createTestDom, detailFixture, type TestDom } from "./test-dom.ts";

const SPACE = "/api/orgs/o1/spaces/s1";
const CR = `${SPACE}/change-requests/4`;

let dom: TestDom;
afterEach(async () => {
  await dom.dispose();
});

function routeDraft(changes: number) {
  dom.route("GET", CR, () => ({
    body: detailFixture({ number: 4, author: "u1" }),
  }));
  dom.route("GET", `${CR}/changes`, () => ({
    body: {
      changes: Array.from({ length: changes }, (_, i) => ({
        entryId: `p${i}`,
        title: `Page ${i}`,
        kind: "changed",
      })),
    },
  }));
  dom.route("GET", `${SPACE}/change-request-workflow`, () => ({
    body: {
      workflow: { mode: "change-requests", requiredApprovals: 0 },
      inherited: true,
    },
  }));
  dom.route("GET", "/api/me", () => ({ body: { user: { id: "u1" } } }));
}

async function renderBar(overrides: Partial<SpaceBarProps> = {}) {
  const ui = { notify: vi.fn(), request: dom.api.call } as never;
  const Bar = createBar(dom.api, ui, createLiveChanges());
  const tasks: (() => Promise<void>)[] = [];
  const props: SpaceBarProps = {
    orgId: "o1",
    spaceId: "s1",
    branch: "cr/4",
    entryId: "p0",
    isEditing: true,
    view: undefined,
    panel: undefined,
    openBranch: vi.fn(),
    openView: vi.fn(),
    openPanel: vi.fn(),
    stopEditing: vi.fn(),
    onStopEditing: (task) => {
      tasks.push(task);
      return () => tasks.splice(tasks.indexOf(task), 1);
    },
    ...overrides,
  };
  await dom.render(createElement(Bar, props));
  return { props, tasks };
}

describe("change request bar", () => {
  it("shows the draft tag, Review changes with the count and Merge", async () => {
    dom = createTestDom();
    routeDraft(2);
    const { props } = await renderBar();
    await dom.waitFor(() => dom.button("Merge"));
    expect(dom.container.textContent).toContain("Draft #4");
    expect(dom.container.textContent).toContain("Review changes2");
    await dom.click(dom.button("Review changes2") ?? dom.container);
    expect(props.openView).toHaveBeenCalledWith("change-requests.changes");
  });

  it("disables Merge while the draft has no changes", async () => {
    dom = createTestDom();
    routeDraft(0);
    await renderBar();
    const merge = await dom.waitFor(() => dom.button("Merge"));
    expect(merge.disabled).toBe(true);
    expect(merge.title).toBe("Nothing to merge yet.");
  });

  it("closes an empty draft of the user's when they press Done", async () => {
    dom = createTestDom();
    routeDraft(0);
    dom.route("POST", `${CR}/close`, () => ({ body: {} }));
    const { tasks } = await renderBar();
    await dom.waitFor(() => dom.button("Merge"));
    await Promise.all(tasks.map((task) => task()));
    expect(
      dom.calls.some(
        (call) => call.method === "POST" && call.path === `${CR}/close`,
      ),
    ).toBe(true);
  });

  it("keeps a draft with changes on Done", async () => {
    dom = createTestDom();
    routeDraft(1);
    const { tasks } = await renderBar();
    await dom.waitFor(() => dom.button("Merge"));
    await Promise.all(tasks.map((task) => task()));
    expect(dom.calls.some((call) => call.path.endsWith("/close"))).toBe(false);
  });

  it("renders nothing on main", async () => {
    dom = createTestDom();
    await renderBar({ branch: "main" });
    expect(dom.container.innerHTML).toBe("");
  });
});

describe("draft finder", () => {
  it("finds the user's latest draft that has changes", async () => {
    dom = createTestDom();
    dom.route("GET", "/api/me", () => ({ body: { user: { id: "u1" } } }));
    dom.route("GET", `${SPACE}/change-requests?status=draft`, () => ({
      body: {
        changeRequests: [
          { number: 6, branch: "cr/6", author: "u1", updatedAt: 9 },
          { number: 4, branch: "cr/4", author: "u1", updatedAt: 5 },
          { number: 7, branch: "cr/7", author: "u2", updatedAt: 10 },
        ],
      },
    }));
    dom.route("GET", `${SPACE}/change-requests/6/changes`, () => ({
      body: { changes: [] },
    }));
    dom.route("GET", `${SPACE}/change-requests/4/changes`, () => ({
      body: { changes: [{ entryId: "p", title: "P", kind: "changed" }] },
    }));
    const find = createDraftFinder(dom.api);
    expect(await find({ orgId: "o1", spaceId: "s1" })).toEqual({
      branch: "cr/4",
      label: "Draft #4",
    });
  });
});
