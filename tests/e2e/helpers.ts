import { expect, type Locator, type Page } from "@playwright/test";

let counter = 0;

/** A slug unique within the run, so tests share one server but no data. */
export function uniqueSlug(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

/** Development sign-in: every email is an instance admin, so it can act in every space. */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/");
  const form = page.getByRole("form", { name: "Development sign-in" });
  await form.getByLabel("Email").fill(email);
  await form.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: "Organizations" }),
  ).toBeVisible();
}

export interface SpaceInfo {
  /** `/orgs/<orgId>/spaces/<spaceId>`. */
  readonly path: string;
  readonly orgId: string;
  readonly spaceId: string;
}

/** Signs in and creates an organization (every plugin on) and a space. */
export async function openNewSpace(
  page: Page,
  email = "author@example.com",
): Promise<SpaceInfo> {
  await signIn(page, email);
  await page.goto("/?new=org");
  const org = page.getByRole("form", { name: "Create organization" });
  await org.getByLabel("Name").fill("E2E");
  await org.getByLabel("Slug").fill(uniqueSlug("org"));
  await org.getByRole("button", { name: "Create organization" }).click();
  await expect(page).toHaveURL(/\/orgs\/[^/?]+$/);

  await page.goto(`${new URL(page.url()).pathname}?new=space`);
  const space = page.getByRole("form", { name: "Create space" });
  await space.getByLabel("Name").fill("Docs");
  await space.getByLabel("Slug").fill(uniqueSlug("space"));
  await space.getByRole("button", { name: "Create space" }).click();
  await expect(page).toHaveURL(/\/orgs\/[^/]+\/spaces\/[^/]+$/);
  const path = new URL(page.url()).pathname;
  const [, , orgId = "", , spaceId = ""] = path.split("/");
  return { path, orgId, spaceId };
}

/** The branch the space view shows, from `?branch=`. */
export function shownBranch(page: Page): string {
  return new URL(page.url()).searchParams.get("branch") ?? "main";
}

export function editorBody(page: Page): Locator {
  return page.getByRole("textbox", { name: "Page body" });
}

/** The space top bar. */
export function bar(page: Page): Locator {
  return page.locator("header.bar");
}

/** The review panel of change request `number`. */
export function panel(page: Page): Locator {
  return page.getByRole("complementary", { name: "Change request" });
}

/** Adds a top-level page; the first write of a visit picks the edit branch. */
export async function newPage(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: /^\+? ?New page$/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/pages\/[^/?]+(\?.*)?$/);
  await expect(editorBody(page)).toBeVisible();
}

/** Saves now (instead of waiting for autosave) and waits for it to land. */
export async function save(page: Page): Promise<void> {
  await editorBody(page).focus();
  await page.keyboard.press("ControlOrMeta+s");
  await expect(bar(page).locator(".save-state")).toHaveText("Saved");
}

/** Leaves the live view for edit mode (Edit or Continue editing). */
export async function startEditing(page: Page): Promise<void> {
  const edit = bar(page).getByRole("button", {
    name: /^(Edit|Continue editing)$/,
  });
  const doneButton = bar(page).getByRole("button", { name: "Done" });
  await expect(edit.or(doneButton)).toBeVisible();
  if (await edit.isVisible()) await edit.click();
  await expect(doneButton).toBeVisible();
}

/** Done: back to the live view of main; a draft with changes stays open. */
export async function done(page: Page): Promise<void> {
  await bar(page).getByRole("button", { name: "Done" }).click();
  await expect(bar(page).getByRole("button", { name: "Done" })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("branch")).toBeNull();
}

/** Types `text` into the body of a fresh page, then saves. */
export async function writeBody(page: Page, text: string): Promise<void> {
  await editorBody(page).click();
  await page.keyboard.type(text);
  await save(page);
}

/** Appends `text` to the paragraph that shows `existing`, then saves. */
export async function appendToParagraph(
  page: Page,
  existing: string,
  text: string,
): Promise<void> {
  await startEditing(page);
  await editorBody(page).getByText(existing).click();
  await page.keyboard.press("End");
  await page.keyboard.type(text);
  await save(page);
}

/** The current page's ID, from the URL. */
export function pageIdOf(page: Page): string {
  const match = /\/pages\/([^/?]+)/.exec(new URL(page.url()).pathname);
  if (!match?.[1]) throw new Error(`not on a page: ${page.url()}`);
  return decodeURIComponent(match[1]);
}

/** The plain text of a page as the server stores it at `branch`, or `undefined` when it does not exist there. */
export async function storedText(
  page: Page,
  space: SpaceInfo,
  pageId: string,
  branch = "main",
): Promise<string | undefined> {
  return page.evaluate(
    async (url) => {
      const response = await fetch(url);
      if (response.status === 404) return undefined;
      if (!response.ok)
        throw new Error(`${response.status} ${await response.text()}`);
      const texts: string[] = [];
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) return node.forEach(walk);
        if (typeof node !== "object" || node === null) return;
        const record = node as Record<string, unknown>;
        if (record.type === "text" && typeof record.text === "string")
          texts.push(record.text);
        walk(record.inline);
        walk(record.content);
      };
      const json = (await response.json()) as { page: { body: unknown } };
      walk(json.page.body);
      return texts.join("\n");
    },
    `/api${space.path}/pages/${pageId}${branch === "main" ? "" : `?branch=${encodeURIComponent(branch)}`}`,
  );
}

/** Sets the space's change-request workflow through its settings page. */
export async function setWorkflow(
  page: Page,
  space: SpaceInfo,
  workflow: {
    mode: "Change requests" | "Direct editing";
    requiredApprovals?: number;
  },
): Promise<void> {
  await page.goto(`${space.path}/settings/change-requests`);
  const form = page.getByRole("form", { name: "Change request workflow" });
  await form.getByLabel("Workflow").selectOption({ label: workflow.mode });
  if (workflow.requiredApprovals !== undefined) {
    await form
      .getByLabel("Required approvals")
      .fill(String(workflow.requiredApprovals));
  }
  // Save only appears when the form differs from what is stored.
  const saveButton = form.getByRole("button", { name: "Save" });
  if (await saveButton.isVisible()) {
    await saveButton.click();
    await expect(form.getByRole("status")).toHaveText("Saved.");
  }
  await page.goto(space.path);
}
