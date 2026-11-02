// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createSettingsPage } from "./settings.tsx";
import { createTestDom, type TestDom } from "./test-dom.ts";

const PATH = "/api/orgs/o1/spaces/s1/change-request-workflow";

let dom: TestDom;
afterEach(async () => {
  await dom.dispose();
});

async function renderPage(inherited: boolean): Promise<void> {
  dom = createTestDom();
  dom.route("GET", PATH, () => ({
    body: {
      workflow: { mode: "change-requests", requiredApprovals: 1 },
      inherited,
    },
  }));
  dom.route("PUT", PATH, () => ({
    body: {
      workflow: { mode: "change-requests", requiredApprovals: 2 },
      inherited: false,
    },
  }));
  const Page = createSettingsPage(dom.api);
  await dom.render(
    createElement(Page, {
      scope: { kind: "space", orgId: "o1", spaceId: "s1" },
    }),
  );
  await dom.waitFor(() => dom.container.querySelector("form"));
}

const approvals = () => {
  const input = dom.container.querySelector<HTMLInputElement>("#cr-approvals");
  if (!input) throw new Error("no approvals field");
  return input;
};

describe("ChangeRequestSettings", () => {
  it("shows Save only once something changed, and Discard puts it back", async () => {
    await renderPage(true);
    expect(dom.button("Save")).toBeUndefined();

    await dom.type(approvals(), "2");
    expect(dom.button("Save")).toBeDefined();

    const discard = dom.button("Discard");
    if (!discard) throw new Error("no Discard");
    await dom.click(discard);
    expect(approvals().value).toBe("1");
    expect(dom.button("Save")).toBeUndefined();
  });

  it("saves the change and says so", async () => {
    await renderPage(true);
    await dom.type(approvals(), "2");
    const save = dom.button("Save");
    if (!save) throw new Error("no Save");
    await dom.click(save);
    await dom.waitFor(() => dom.container.textContent?.includes("Saved."));
    expect(dom.calls.filter((call) => call.method === "PUT")).toEqual([
      {
        method: "PUT",
        path: PATH,
        body: { workflow: { mode: "change-requests", requiredApprovals: 2 } },
      },
    ]);
  });

  it("offers to inherit again only when the space has its own setting", async () => {
    await renderPage(true);
    expect(dom.container.textContent).toContain(
      "Inherited from the organization.",
    );
    expect(dom.button("Use the organization's")).toBeUndefined();
    await dom.dispose();

    await renderPage(false);
    expect(dom.button("Use the organization's")).toBeDefined();
  });
});
