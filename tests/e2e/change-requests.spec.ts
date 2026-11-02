import { expect, test, type Page } from "@playwright/test";
import {
  appendToParagraph,
  bar,
  done,
  editorBody,
  newPage,
  openNewSpace,
  pageIdOf,
  panel,
  save,
  setWorkflow,
  shownBranch,
  signIn,
  startEditing,
  storedText,
  writeBody,
  type SpaceInfo,
} from "./helpers.ts";

function appUrl(space: SpaceInfo, number: number): string {
  return `/apps/change-requests/${space.orgId}/${space.spaceId}/${number}`;
}

function sidebar(page: Page) {
  return page.getByRole("navigation", { name: "Change requests" });
}

/** Merges the draft shown in the top bar and lands on the live view of main. */
async function mergeFromBar(page: Page): Promise<void> {
  const merge = bar(page).getByRole("button", { name: "Merge" });
  await expect(merge).toBeEnabled();
  await merge.click();
  await expect(bar(page).getByRole("button", { name: "Done" })).toHaveCount(0);
  expect(shownBranch(page)).toBe("main");
}

test("editing a space at main moves the edit to a new change request", async ({
  page,
}) => {
  const space = await openNewSpace(page);
  await newPage(page);
  expect(shownBranch(page)).toBe("cr/1");
  await expect(
    bar(page).getByRole("button", { name: "Draft #1" }),
  ).toBeVisible();

  await writeBody(page, "Draft text");
  const pageId = pageIdOf(page);
  expect(await storedText(page, space, pageId, "cr/1")).toBe("Draft text");
  expect(await storedText(page, space, pageId)).toBeUndefined();
  await expect(
    sidebar(page).getByRole("link", { name: "#1 Untitled change request" }),
  ).toHaveAttribute("aria-current", "page");

  // Further edits of the visit stay on the same change request.
  await editorBody(page).getByText("Draft text").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" and more");
  await save(page);
  expect(shownBranch(page)).toBe("cr/1");
  expect(await storedText(page, space, pageId, "cr/1")).toBe(
    "Draft text and more",
  );

  // Done keeps the draft; Edit on main resumes it.
  await done(page);
  await expect(
    bar(page).getByRole("button", { name: "Continue editing" }),
  ).toBeVisible();
  await startEditing(page);
  expect(shownBranch(page)).toBe("cr/1");
});

test("one click merges a change request into main", async ({ page }) => {
  const space = await openNewSpace(page);
  await newPage(page);
  await writeBody(page, "Merged text");
  const pageId = pageIdOf(page);

  await mergeFromBar(page);
  expect(await storedText(page, space, pageId)).toBe("Merged text");
  await expect(editorBody(page)).toContainText("Merged text");
  await expect(sidebar(page)).toContainText("No open change requests.");
});

test("a draft without changes goes away on Done", async ({ page }) => {
  const space = await openNewSpace(page);
  await newPage(page);
  await writeBody(page, "Start");
  await mergeFromBar(page);

  await startEditing(page);
  // Opening a draft is not yet a change; nothing is written until typing.
  await page.locator(".trow").first().hover();
  await page
    .getByRole("button", { name: /^Actions for/ })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(page).toHaveURL(/branch=cr%2F2/);
  await page
    .getByRole("navigation", { name: "Pages" })
    .getByRole("link", { name: /\(copy\)$/ })
    .hover();
  await page.getByRole("button", { name: /^Actions for .*\(copy\)$/ }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(bar(page).getByRole("button", { name: "Merge" })).toBeDisabled();

  await done(page);
  await page.goto(`/apps/change-requests/${space.orgId}/${space.spaceId}`);
  await page.getByRole("button", { name: "Closed" }).click();
  await expect(page.getByRole("main")).toContainText(
    "#2 Untitled change request",
  );
});

test("a conflict with main is resolved in the app, then rebased and merged", async ({
  page,
  browser,
}) => {
  const space = await openNewSpace(page);
  await newPage(page);
  await writeBody(page, "Original text");
  const pageId = pageIdOf(page);
  await mergeFromBar(page);

  // Another author edits the same paragraph and merges first.
  const otherContext = await browser.newContext();
  try {
    const other = await otherContext.newPage();
    await signIn(other, "other@example.com");
    await other.goto(`${space.path}/pages/${pageId}`);
    await appendToParagraph(other, "Original text", " three");
    expect(shownBranch(other)).toBe("cr/2");

    await appendToParagraph(page, "Original text", " two");
    expect(shownBranch(page)).toBe("cr/3");

    await mergeFromBar(other);
  } finally {
    await otherContext.close();
  }
  expect(await storedText(page, space, pageId)).toBe("Original text three");

  await page.reload();
  const resolve = bar(page).getByRole("link", { name: "Resolve 1 conflict" });
  await expect(resolve).toBeVisible();
  await resolve.click();
  // Conflicts open inside the space, so its tree stays in the sidebar.
  await expect(page).toHaveURL(
    `${space.path}?view=change-requests.requests&cr=3&conflicts=1`,
  );
  await expect(
    page.getByRole("navigation", { name: "Pages", exact: true }),
  ).toBeVisible();

  const conflict = page.getByRole("region", {
    name: "Page “Untitled”: block (paragraph)",
  });
  await expect(conflict.locator(".cr-side").first()).toContainText(
    "Original text three",
  );
  await expect(conflict.locator(".cr-side").last()).toContainText(
    "Original text two",
  );
  await expect(
    page.getByRole("button", { name: "Update from main" }),
  ).toBeDisabled();
  await conflict.getByRole("button", { name: "Use change request" }).click();
  await expect(conflict).toContainText(
    "Resolved: using the change request (not saved yet)",
  );
  await page.getByRole("button", { name: "Save resolutions" }).click();
  await expect(conflict).toContainText("Resolved: using the change request");
  await expect(conflict).not.toContainText("not saved yet");

  await page.getByRole("button", { name: "Update from main" }).click();
  await expect(page).toHaveURL(
    `${space.path}?view=change-requests.requests&cr=3`,
  );
  expect(await storedText(page, space, pageId, "cr/3")).toBe(
    "Original text two",
  );
  const merge = page.getByRole("button", { name: "Merge" });
  await expect(merge).toBeEnabled();
  await merge.click();
  await expect(page.locator(".cr-status")).toHaveText("Merged");
  expect(await storedText(page, space, pageId)).toBe("Original text two");
});

test("a required approval comes from a second user and counts for the latest changes only", async ({
  page,
  browser,
}) => {
  const space = await openNewSpace(page);
  await setWorkflow(page, space, {
    mode: "Change requests",
    requiredApprovals: 1,
  });
  await newPage(page);
  await writeBody(page, "Needs review");
  const pageId = pageIdOf(page);

  await bar(page).getByRole("button", { name: "Request review" }).click();
  await expect(
    bar(page).getByRole("button", { name: "In review #1" }),
  ).toBeVisible();
  const merge = bar(page).getByRole("button", { name: "Merge" });
  await expect(merge).toBeDisabled();
  await expect(merge).toHaveAttribute("title", "Needs 0 of 1 approvals.");

  const reviewerContext = await browser.newContext();
  try {
    const reviewer = await reviewerContext.newPage();
    await signIn(reviewer, "reviewer@example.com");
    const approve = async (): Promise<void> => {
      // A deep link into the app, which loads the plugin UI on its own.
      await reviewer.goto(appUrl(space, 1));
      await reviewer.getByRole("button", { name: "Approve" }).click();
      await expect(
        reviewer.getByRole("button", { name: "Withdraw approval" }),
      ).toBeVisible();
      await expect(
        reviewer
          .getByRole("complementary", { name: "Status" })
          .getByRole("listitem")
          .filter({ hasText: "reviewer" }),
      ).toBeVisible();
    };
    await reviewer.goto(
      `/apps/change-requests/${space.orgId}/${space.spaceId}`,
    );
    await expect(reviewer.getByRole("main")).toContainText("by author");
    await approve();

    // A new commit drops the approval, so the reviewer approves again.
    await page.reload();
    await expect(merge).toBeEnabled();
    await appendToParagraph(page, "Needs review", " again");
    expect(shownBranch(page)).toBe("cr/1");
    await expect(merge).toBeDisabled();
    await approve();
  } finally {
    await reviewerContext.close();
  }

  await page.reload();
  await mergeFromBar(page);
  expect(await storedText(page, space, pageId)).toBe("Needs review again");
});

test("a required check from a plugin blocks the merge until it passes", async ({
  page,
}) => {
  const space = await openNewSpace(page);
  await newPage(page);
  await writeBody(page, "Release notes");
  const pageId = pageIdOf(page);
  await expect(bar(page).getByRole("button", { name: "Merge" })).toBeEnabled();

  // The review panel renames the change request, then shows its checks.
  await bar(page).getByRole("button", { name: "Draft #1" }).click();
  const title = panel(page).getByLabel("Change request title");
  await expect(title).toHaveValue("Untitled change request");
  await title.fill("Release 1.0");
  await title.press("Enter");
  await expect(panel(page)).toContainText("Release ticket");
  await expect(
    panel(page).getByRole("button", { name: "Merge into main" }),
  ).toBeDisabled();

  await page.goto(appUrl(space, 1));
  const main = page.getByRole("main");
  const checks = page.getByRole("list", { name: "Checks" });
  const merge = page.getByRole("button", { name: "Merge" });
  await expect(checks).toHaveText(
    "Failed Release ticket (required) – Name a ticket such as DOC-1.",
  );
  await expect(main).toContainText("Required checks failed: Release ticket.");
  await expect(merge).toBeDisabled();

  await page
    .getByRole("button", { name: "Edit title and description" })
    .click();
  const form = page.getByRole("form", { name: "Edit change request" });
  await form.getByLabel("Title").fill("Release 1.0 (DOC-7)");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "#1 Release 1.0 (DOC-7)",
  );
  await expect(checks).toHaveText("Passed Release ticket (required)");
  await expect(merge).toBeEnabled();
  await merge.click();
  await expect(page.locator(".cr-status")).toHaveText("Merged");
  expect(await storedText(page, space, pageId)).toBe("Release notes");
});

test("direct mode edits main", async ({ page }) => {
  const space = await openNewSpace(page);
  await setWorkflow(page, space, { mode: "Direct editing" });
  await newPage(page);
  expect(shownBranch(page)).toBe("main");
  await expect(bar(page).getByText("Editing", { exact: true })).toBeVisible();
  await writeBody(page, "Straight to main");
  expect(await storedText(page, space, pageIdOf(page))).toBe(
    "Straight to main",
  );
  await expect(bar(page).getByRole("button", { name: "Merge" })).toHaveCount(0);
  await expect(sidebar(page)).toContainText("No open change requests.");
});
