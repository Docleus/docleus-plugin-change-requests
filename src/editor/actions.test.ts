// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChangeRequest, ChangeRequestState } from "../shared/index.ts";
import { ChangeRequestActions } from "./actions.tsx";
import { getChangeRequest } from "./api.ts";
import { useLoad } from "./use-load.ts";
import { createTestDom, detailFixture, type TestDom } from "./test-dom.ts";

const CR = "/api/orgs/o1/spaces/s1/change-requests/4";

let dom: TestDom;
afterEach(async () => {
  vi.unstubAllGlobals();
  await dom.dispose();
});

async function renderActions(
  changeRequest: Partial<ChangeRequest>,
  state: Partial<ChangeRequestState> = {},
  branch = "cr/4",
) {
  dom = createTestDom();
  dom.route("GET", CR, () => ({
    body: detailFixture({ number: 4, ...changeRequest }, state),
  }));
  dom.route("GET", "/api/me", () => ({ body: { user: { id: "u2" } } }));
  const openBranch = vi.fn<(name: string) => void>();
  const reloadPage = vi.fn<() => void>();
  const space = { orgId: "o1", spaceId: "s1" };
  const api = dom.api;
  // What the detail page renders: the actions of the loaded change request.
  function Harness() {
    const detail = useLoad("cr", () => getChangeRequest(api, space, 4));
    const userId = useLoad("me", () =>
      api
        .call<{ user: { id: string } }>("GET", "/api/me")
        .then((me) => me.user.id),
    );
    if (!detail.data) return null;
    return createElement(ChangeRequestActions, {
      api,
      space,
      detail: detail.data,
      userId: userId.data,
      onChange: detail.reload,
      onRebased: reloadPage,
      onFinished: () => openBranch("main"),
    });
  }
  if (branch === "cr/4") await dom.render(createElement(Harness));
  return { openBranch, reloadPage };
}

describe("change request actions", () => {
  it("offers a review request on an editable draft", async () => {
    await renderActions({ status: "draft" });
    await dom.waitFor(() => dom.button("Merge"));
    expect(dom.buttons()).toEqual(["Request review", "Merge", "Close"]);
    expect(
      ["Request review", "Merge", "Close"].filter((name) =>
        dom.button(name)?.classList.contains("is-primary"),
      ),
    ).toEqual(["Merge"]);
    dom.route("POST", `${CR}/request-review`, () => ({ body: {} }));
    const review = dom.button("Request review");
    expect(review).toBeDefined();
    if (review) await dom.click(review);
    expect(dom.calls.some((c) => c.path === `${CR}/request-review`)).toBe(true);
  });

  it("offers approval to a reviewer and withdrawal once approved", async () => {
    await renderActions(
      { status: "open", author: "u1" },
      {
        canApprove: true,
        canEdit: false,
        canMerge: false,
        requiredApprovals: 1,
      },
    );
    await dom.waitFor(() => dom.button("Approve"));
    expect(dom.buttons()).toEqual(["Approve", "Merge"]);
    expect(dom.button("Merge")?.disabled).toBe(true);
    expect(dom.container.textContent).toContain("Needs 0 of 1 approvals.");
    // The step that moves it on is the one filled button.
    expect(dom.button("Approve")?.classList.contains("is-primary")).toBe(true);
    expect(dom.button("Merge")?.classList.contains("is-primary")).toBe(false);
    await dom.dispose();

    await renderActions(
      {
        status: "open",
        approvals: [{ userId: "u2", name: "Bea", at: 0 }],
      },
      { canApprove: true, canEdit: false },
    );
    await dom.waitFor(() => dom.button("Withdraw approval"));
    expect(dom.button("Approve")).toBeUndefined();
    dom.route("DELETE", `${CR}/approve`, () => ({ body: {} }));
    const withdraw = dom.button("Withdraw approval");
    if (withdraw) await dom.click(withdraw);
    expect(
      dom.calls.some(
        (c) => c.method === "DELETE" && c.path === `${CR}/approve`,
      ),
    ).toBe(true);
  });

  it("asks for a review before merging a draft that needs approvals", async () => {
    await renderActions(
      { status: "draft" },
      { canMerge: false, requiredApprovals: 2 },
    );
    const merge = await dom.waitFor(() => dom.button("Merge"));
    expect(merge.disabled).toBe(true);
    const blocker = merge.getAttribute("aria-describedby");
    expect(blocker).not.toBeNull();
    expect(dom.container.querySelector(`#${blocker}`)?.textContent).toBe(
      "Request a review first.",
    );
  });

  it("names the required checks that block the merge", async () => {
    const check = {
      title: "Lint",
      isRequired: true,
      status: "failure",
      name: "acme.lint",
    } as const;
    await renderActions(
      { status: "open" },
      {
        canMerge: false,
        checks: [
          check,
          {
            ...check,
            name: "acme.spell",
            title: "Spelling",
            isRequired: false,
          },
        ],
      },
    );
    const merge = await dom.waitFor(() => dom.button("Merge"));
    expect(merge.disabled).toBe(true);
    expect(dom.container.textContent).toContain(
      "Required checks failed: Lint.",
    );
    await dom.dispose();

    await renderActions(
      { status: "open" },
      { canMerge: false, checks: [{ ...check, status: "pending" }] },
    );
    await dom.waitFor(() => dom.button("Merge"));
    expect(dom.container.textContent).toContain(
      "Waiting for required checks: Lint.",
    );
  });

  it("updates from main when behind, then reloads the page", async () => {
    const { reloadPage } = await renderActions(
      { status: "open" },
      { isBehind: true },
    );
    const rebase = await dom.waitFor(() => dom.button("Update from main"));
    dom.route("POST", `${CR}/rebase`, () => ({ body: {} }));
    await dom.click(rebase);
    expect(reloadPage).toHaveBeenCalledOnce();
  });

  it("links to conflict resolution instead of rebasing when there are conflicts", async () => {
    await renderActions(
      { status: "open" },
      { isBehind: true, conflicts: 2, canMerge: false },
    );
    const link = await dom.waitFor(() =>
      [...dom.container.querySelectorAll("a")].find(
        (a) => a.textContent === "Resolve conflicts",
      ),
    );
    expect(link.getAttribute("href")).toBe(
      "/orgs/o1/spaces/s1?view=change-requests.requests&cr=4&conflicts=1",
    );
    expect(dom.button("Update from main")).toBeUndefined();
    expect(dom.button("Merge")?.disabled).toBe(true);
    expect(dom.container.textContent).toContain(
      "2 conflicts with main must be resolved first.",
    );
  });

  it("goes back to main after a merge", async () => {
    const { openBranch } = await renderActions({ status: "open" });
    const merge = await dom.waitFor(() => dom.button("Merge"));
    dom.route("POST", `${CR}/merge`, () => ({ body: {} }));
    await dom.click(merge);
    expect(openBranch).toHaveBeenCalledWith("main");
  });

  it("goes back to main after a confirmed close", async () => {
    const { openBranch } = await renderActions({ status: "open" });
    const close = await dom.waitFor(() => dom.button("Close"));
    dom.route("POST", `${CR}/close`, () => ({ body: {} }));
    const confirm = vi.fn<(message: string) => boolean>();
    vi.stubGlobal("confirm", confirm);
    confirm.mockReturnValueOnce(false);
    await dom.click(close);
    expect(openBranch).not.toHaveBeenCalled();
    confirm.mockReturnValueOnce(true);
    await dom.click(close);
    expect(confirm).toHaveBeenLastCalledWith(
      "Close change request #4? Its edits are discarded.",
    );
    expect(openBranch).toHaveBeenCalledWith("main");
  });

  it("shows a failed action as an alert and stays on the branch", async () => {
    const { openBranch } = await renderActions({ status: "open" });
    const merge = await dom.waitFor(() => dom.button("Merge"));
    dom.route("POST", `${CR}/merge`, () => ({
      status: 409,
      body: { code: "change-requests/conflicts", message: "main moved" },
    }));
    await dom.click(merge);
    expect(dom.container.querySelector('[role="alert"]')?.textContent).toBe(
      "main moved",
    );
    expect(openBranch).not.toHaveBeenCalled();
  });
});
