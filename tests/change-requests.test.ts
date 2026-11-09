import { randomUUID } from "node:crypto";
import { testStorageDialect } from "@docleus/testing";
import { sql } from "kysely";
import {
  MAIN_BRANCH,
  type ChangeRequestChecksInput,
  type Context,
  type EntryContent,
  type MergeCheck,
  type MergeConflict,
} from "@docleus/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ChangeRequest,
  ChangeRequestState,
  EntryChange,
  WorkflowSettings,
} from "../src/shared/index.ts";
import { CHANGE_REQUEST_MERGED } from "../src/server/index.ts";
import { errorOf, setUp, type Client, type Fixture } from "./helpers.ts";

interface One {
  changeRequest: ChangeRequest;
  state: ChangeRequestState;
}
interface Landed {
  changeRequest: ChangeRequest;
  head: string;
}
interface ConflictsView {
  main: string | null;
  conflicts: MergeConflict[];
  resolutions: Record<string, unknown>;
}
interface EffectiveWorkflow {
  workflow: WorkflowSettings;
  inherited: boolean;
}

const createId = () => randomUUID().replaceAll("-", "");

let f: Fixture;

beforeEach(async () => {
  f = await setUp();
});

afterEach(async () => {
  await f.dispose();
});

const cr = (path = "") => `${f.space}/change-requests${path}`;

function page(title: string): EntryContent {
  return {
    type: "page",
    title,
    parent: undefined,
    order: 0,
    fields: {},
    body: {
      id: createId(),
      type: "doc",
      v: 1,
      attrs: {},
      content: [{ id: createId(), type: "paragraph", v: 1, attrs: {} }],
    },
  };
}

/** A system commit (no author) to `main`, which the protection lets through. */
async function seed(titles: readonly string[]): Promise<string[]> {
  const ids = titles.map(() => createId());
  const head = await f.instance.ctx.content.head(f.spaceId);
  await f.instance.ctx.content.commit({
    spaceId: f.spaceId,
    parent: head?.id,
    put: Object.fromEntries(ids.map((id, i) => [id, page(titles[i] ?? "")])),
    message: "Seed",
  });
  return ids;
}

async function open(user: Client, title = "Change"): Promise<ChangeRequest> {
  const { changeRequest } = await user.json<{ changeRequest: ChangeRequest }>(
    "POST",
    cr(),
    { title },
  );
  return changeRequest;
}

function onBranch(path: string, branch: string): string {
  return `${f.space}${path}?branch=${encodeURIComponent(branch)}`;
}

async function executeSql(query: string): Promise<void> {
  await sql.raw(query).execute(f.instance.ctx.storage.db);
}

async function rename(
  user: Client,
  branch: string,
  pageId: string,
  title: string,
): Promise<void> {
  await user.json("PATCH", onBranch(`/pages/${pageId}`, branch), { title });
}

async function titlesOn(branch: string): Promise<string[]> {
  const head = await f.instance.ctx.content.head(f.spaceId, branch);
  if (!head) return [];
  const entries = await f.instance.ctx.content.listEntries(head.id);
  return entries.map((entry) => entry.title).toSorted();
}

async function setWorkflow(workflow: WorkflowSettings | null): Promise<void> {
  await f.owner.json("PUT", `${f.space}/change-request-workflow`, {
    workflow,
  });
}

/** A change request with one page, in review. */
async function inReview(): Promise<ChangeRequest> {
  const changeRequest = await open(f.alice);
  await f.alice.json("POST", onBranch("/pages", changeRequest.branch), {
    title: "Guide",
  });
  await f.alice.json("POST", cr(`/${changeRequest.number}/request-review`));
  return changeRequest;
}

/** A change request in review that Bob approved. */
async function approvedByBob(): Promise<ChangeRequest> {
  const changeRequest = await inReview();
  await f.bob.json("POST", cr(`/${changeRequest.number}/approve`));
  return changeRequest;
}

async function expectNotMergeable(number: number): Promise<void> {
  const { changeRequest, state } = await f.alice.json<One>(
    "GET",
    cr(`/${number}`),
  );
  expect(changeRequest.approvals).toEqual([]);
  expect(state.canMerge).toBe(false);
  const merge = await errorOf(
    await f.alice.call("POST", cr(`/${number}/merge`)),
  );
  expect(merge).toMatchObject({
    status: 403,
    body: { code: "change-requests/not-allowed" },
  });
  const bobView = await f.bob.json<One>("GET", cr(`/${number}`));
  expect(bobView.state.canApprove).toBe(true);
}

function lint(status: MergeCheck["status"], isRequired = true): MergeCheck {
  return { name: "acme.lint", title: "Lint", status, isRequired };
}

async function expectBlocked(number: number): Promise<readonly MergeCheck[]> {
  const { state } = await f.alice.json<One>("GET", cr(`/${number}`));
  expect(state.canMerge).toBe(false);
  const merge = await errorOf(
    await f.alice.call("POST", cr(`/${number}/merge`)),
  );
  expect(merge).toMatchObject({
    status: 409,
    body: { code: "change-requests/checks-failed" },
  });
  expect(await titlesOn(MAIN_BRANCH)).toEqual([]);
  return state.checks;
}

describe("editing in a change request", () => {
  it("creates numbered drafts with their own branches", async () => {
    await seed(["Intro"]);
    const main = await f.instance.ctx.content.head(f.spaceId);
    const first = await open(f.alice, "  First ");
    const second = await open(f.bob);
    expect(first).toMatchObject({
      number: 1,
      title: "First",
      status: "draft",
      branch: "cr/1",
      author: f.alice.userId,
      authorName: "Alice",
      approvals: [],
    });
    expect(second.number).toBe(2);
    const branch = await f.instance.ctx.content.getBranch(f.spaceId, "cr/1");
    expect(branch).toMatchObject({ head: main?.id, base: main?.id });

    const untitled = await f.alice.json<{ changeRequest: ChangeRequest }>(
      "POST",
      cr(),
    );
    expect(untitled.changeRequest.title).toBe("Untitled change request");
  });

  it("commits page edits to the branch and leaves main alone", async () => {
    const [intro = ""] = await seed(["Intro"]);
    const { branch, number } = await open(f.alice);
    const created = await f.alice.call("POST", onBranch("/pages", branch), {
      title: "Guide",
    });
    expect(created.status).toBe(201);
    await rename(f.alice, branch, intro, "Welcome");

    expect(await titlesOn(MAIN_BRANCH)).toEqual(["Intro"]);
    expect(await titlesOn(branch)).toEqual(["Guide", "Welcome"]);
    const head = await f.instance.ctx.content.head(f.spaceId, branch);
    expect(head?.author).toBe(f.alice.userId);

    const { changes } = await f.alice.json<{ changes: EntryChange[] }>(
      "GET",
      cr(`/${number}/changes`),
    );
    expect(changes).toHaveLength(2);
    expect(changes).toEqual(
      expect.arrayContaining([
        { entryId: intro, title: "Welcome", kind: "changed" },
        expect.objectContaining({ title: "Guide", kind: "added" }),
      ]),
    );
  });

  it("lets the author or a space admin edit the title and description", async () => {
    const { number } = await open(f.alice);
    await f.alice.json("POST", cr(`/${number}/request-review`));
    const patched = await f.alice.json<{ changeRequest: ChangeRequest }>(
      "PATCH",
      cr(`/${number}`),
      { title: "Better", description: "Why" },
    );
    expect(patched.changeRequest).toMatchObject({
      title: "Better",
      description: "Why",
    });
    const denied = await errorOf(
      await f.bob.call("PATCH", cr(`/${number}`), { title: "Mine" }),
    );
    expect(denied).toMatchObject({
      status: 403,
      body: { code: "change-requests/not-allowed" },
    });
    const byAdmin = await f.owner.call("PATCH", cr(`/${number}`), {
      description: "Edited",
    });
    expect(byAdmin.status).toBe(200);
    const invalid = await f.alice.call("PATCH", cr(`/${number}`), {
      status: "merged",
    });
    expect(invalid.status).toBe(400);
  });
});

describe("main protection", () => {
  it("rejects user commits to main in change-request mode", async () => {
    const response = await errorOf(
      await f.alice.call("POST", `${f.space}/pages`, { title: "Direct" }),
    );
    expect(response).toMatchObject({
      status: 409,
      body: { code: "change-requests/commit-rejected" },
    });
    expect(await titlesOn(MAIN_BRANCH)).toEqual([]);
  });

  it("allows system commits to main", async () => {
    await seed(["System"]);
    expect(await titlesOn(MAIN_BRANCH)).toEqual(["System"]);
  });

  it("allows user commits to main in direct mode", async () => {
    await setWorkflow({ mode: "direct", requiredApprovals: 0 });
    const response = await f.alice.call("POST", `${f.space}/pages`, {
      title: "Direct",
    });
    expect(response.status).toBe(201);
    expect(await titlesOn(MAIN_BRANCH)).toEqual(["Direct"]);

    await setWorkflow(null);
    const again = await f.alice.call("POST", `${f.space}/pages`, {
      title: "Again",
    });
    expect(again.status).toBe(409);
  });

  it("does not protect main in spaces without the plugin", async () => {
    const other = await f.createSpace("other", false);
    const response = await f.owner.call(
      "POST",
      `/api/orgs/${f.orgId}/spaces/${other}/pages`,
      { title: "Free" },
    );
    expect(response.status).toBe(201);
  });
});

describe("workflow settings", () => {
  it("inherits org settings and lets a space override them", async () => {
    const orgPath = `/api/orgs/${f.orgId}/change-request-workflow`;
    const spacePath = `${f.space}/change-request-workflow`;
    expect(await f.alice.json<EffectiveWorkflow>("GET", spacePath)).toEqual({
      workflow: { mode: "change-requests", requiredApprovals: 0 },
      inherited: true,
    });

    await f.owner.json("PUT", orgPath, {
      workflow: { mode: "direct", requiredApprovals: 0 },
    });
    expect(await f.owner.json<EffectiveWorkflow>("GET", orgPath)).toEqual({
      workflow: { mode: "direct", requiredApprovals: 0 },
      inherited: false,
    });
    expect(await f.alice.json<EffectiveWorkflow>("GET", spacePath)).toEqual({
      workflow: { mode: "direct", requiredApprovals: 0 },
      inherited: true,
    });

    const own = await f.owner.json<EffectiveWorkflow>("PUT", spacePath, {
      workflow: { mode: "change-requests", requiredApprovals: 2 },
    });
    expect(own).toEqual({
      workflow: { mode: "change-requests", requiredApprovals: 2 },
      inherited: false,
    });

    const cleared = await f.owner.json<EffectiveWorkflow>("PUT", spacePath, {
      workflow: null,
    });
    expect(cleared).toEqual({
      workflow: { mode: "direct", requiredApprovals: 0 },
      inherited: true,
    });
  });

  it("needs manage to change settings and validates them", async () => {
    const spacePath = `${f.space}/change-request-workflow`;
    const denied = await f.alice.call("PUT", spacePath, { workflow: null });
    expect(denied.status).toBe(403);
    const orgDenied = await f.alice.call(
      "PUT",
      `/api/orgs/${f.orgId}/change-request-workflow`,
      { workflow: null },
    );
    expect(orgDenied.status).toBe(403);
    const invalid = await f.owner.call("PUT", spacePath, {
      workflow: { mode: "direct", requiredApprovals: -1 },
    });
    expect(invalid.status).toBe(400);
  });

  it("falls back to the default for invalid stored settings", async () => {
    await f.instance.ctx.installations.setSettings(
      "@docleus/plugin-change-requests",
      { kind: "space", orgId: f.orgId, spaceId: f.spaceId },
      { mode: "sideways", level: "space" },
    );
    const { workflow } = await f.alice.json<EffectiveWorkflow>(
      "GET",
      `${f.space}/change-request-workflow`,
    );
    expect(workflow).toEqual({ mode: "change-requests", requiredApprovals: 0 });
  });
});

describe("merging", () => {
  it
    .skipIf(testStorageDialect() !== "sqlite")
    .each([
      "BEFORE INSERT ON content_log WHEN NEW.type = 'change-request/merged'",
      "BEFORE UPDATE ON change_requests WHEN NEW.status = 'merged'",
      "BEFORE DELETE ON branches WHEN OLD.name = 'cr/1'",
      "BEFORE DELETE ON change_request_resolutions",
    ])(
    "resumes a partial merge without another main commit: %s",
    async (failure) => {
      await seed(["Intro"]);
      const { branch, number } = await open(f.alice);
      await f.alice.json("POST", onBranch("/pages", branch), {
        title: "Guide",
      });
      await executeSql(
        "INSERT INTO change_request_resolutions VALUES ('" +
          f.spaceId +
          "', 1, 'old', '{}')",
      );
      await executeSql(
        `CREATE TRIGGER fail_merge ${failure} BEGIN SELECT RAISE(FAIL, 'injected merge completion failure'); END`,
      );
      expect((await f.alice.call("POST", cr(`/${number}/merge`))).status).toBe(
        500,
      );
      const landed = await f.instance.ctx.content.head(f.spaceId);
      expect(landed?.merged).toBeDefined();
      await executeSql("DROP TRIGGER fail_merge");
      if (failure.startsWith("BEFORE UPDATE")) {
        for (let i = 0; i < 1001; i++) {
          await f.instance.ctx.content.append("test/padding", {});
        }
      }
      // Recovery must also find a landed merge after main moves forward.
      await seed(["Later"]);
      const current = await f.instance.ctx.content.head(f.spaceId);
      const result = await f.owner.json<Landed>("POST", cr(`/${number}/merge`));
      expect(result.head).toBe(landed?.id);
      expect(result.changeRequest).toMatchObject({
        status: "merged",
        mergedBy: f.alice.userId,
        mergedAt: landed?.at,
        mergedRevision: landed?.id,
      });
      expect((await f.instance.ctx.content.head(f.spaceId))?.id).toBe(
        current?.id,
      );
      expect(
        await f.instance.ctx.content.getBranch(f.spaceId, branch),
      ).toBeUndefined();
      const events: unknown[] = [];
      let afterSeq = 0;
      for (;;) {
        const log = await f.instance.ctx.content.readLog({
          afterSeq,
          limit: 1000,
        });
        events.push(
          ...log.filter((entry) => entry.type === CHANGE_REQUEST_MERGED),
        );
        afterSeq = log.at(-1)?.seq ?? afterSeq;
        if (log.length < 1000) break;
      }
      expect(events).toHaveLength(1);
      expect(await titlesOn(MAIN_BRANCH)).toEqual(["Guide", "Intro", "Later"]);
      const remaining =
        await sql`SELECT * FROM change_request_resolutions`.execute(
          f.instance.ctx.storage.db,
        );
      expect(remaining.rows).toEqual([]);
    },
  );

  it.skipIf(testStorageDialect() !== "sqlite")(
    "retains a branch changed after a partially recorded merge",
    async () => {
      const { branch, number } = await open(f.alice);
      await f.alice.json("POST", onBranch("/pages", branch), {
        title: "Guide",
      });
      await executeSql(
        "CREATE TRIGGER fail_merge BEFORE INSERT ON content_log WHEN NEW.type = 'change-request/merged' BEGIN SELECT RAISE(FAIL, 'injected event failure'); END",
      );
      expect((await f.alice.call("POST", cr(`/${number}/merge`))).status).toBe(
        500,
      );
      const landed = await f.instance.ctx.content.head(f.spaceId);
      await executeSql("DROP TRIGGER fail_merge");
      await f.alice.json("POST", onBranch("/pages", branch), {
        title: "New draft",
      });
      expect(
        await errorOf(await f.alice.call("POST", cr(`/${number}/merge`))),
      ).toMatchObject({
        status: 409,
        body: { code: "change-requests/invalid-state" },
      });
      expect((await f.instance.ctx.content.head(f.spaceId))?.id).toBe(
        landed?.id,
      );
      expect(await titlesOn(branch)).toEqual(["Guide", "New draft"]);
    },
  );

  it("merges a change request in one click", async () => {
    await seed(["Intro"]);
    const { branch, number } = await open(f.alice, "Add guide");
    await f.alice.json("POST", onBranch("/pages", branch), { title: "Guide" });
    const branchHead = await f.instance.ctx.content.head(f.spaceId, branch);

    const { changeRequest, head } = await f.alice.json<Landed>(
      "POST",
      cr(`/${number}/merge`),
    );
    expect(changeRequest).toMatchObject({
      status: "merged",
      mergedBy: f.alice.userId,
      mergedRevision: head,
    });
    expect(changeRequest.mergedAt).toBeTypeOf("number");
    expect(await titlesOn(MAIN_BRANCH)).toEqual(["Guide", "Intro"]);

    const revision = await f.instance.ctx.content.getRevision(head);
    expect(revision).toMatchObject({
      branch: MAIN_BRANCH,
      author: f.alice.userId,
      merged: branchHead?.id,
      message: "Merge change request #1: Add guide",
    });
    expect(
      await f.instance.ctx.content.getBranch(f.spaceId, branch),
    ).toBeUndefined();

    const log = await f.instance.ctx.content.readLog();
    expect(log.filter((entry) => entry.type === CHANGE_REQUEST_MERGED)).toEqual(
      [
        expect.objectContaining({
          payload: { spaceId: f.spaceId, number, revision: head, branch },
        }),
      ],
    );

    const { changes } = await f.alice.json<{ changes: EntryChange[] }>(
      "GET",
      cr(`/${number}/changes`),
    );
    expect(changes).toEqual([
      expect.objectContaining({ title: "Guide", kind: "added" }),
    ]);
    const { state } = await f.alice.json<One>("GET", cr(`/${number}`));
    expect(state).toMatchObject({ canMerge: false, canEdit: false });
  });

  it("flushes unsaved edits of the branch before merging, rebasing and listing conflicts", async () => {
    const flushed: string[] = [];
    let pending: string | undefined;
    const fiber = await f.instance.ctx.plugin({
      name: "pending-edits",
      inject: ["content"],
      apply(ctx: Context) {
        ctx.on("content/flush", async ({ spaceId, branch }) => {
          flushed.push(branch);
          if (pending === undefined) return;
          const title = pending;
          pending = undefined;
          const head = await ctx.content.head(spaceId, branch);
          await ctx.content.commit({
            spaceId,
            branch,
            parent: head?.id,
            put: { [createId()]: page(title) },
            message: "Shared edit",
            author: f.alice.userId,
          });
        });
      },
    });
    await seed(["Intro"]);
    const { branch, number } = await open(f.alice);

    await f.alice.json("GET", cr(`/${number}/conflicts`));
    pending = "Rebased";
    await f.alice.json("POST", cr(`/${number}/rebase`));
    expect(await titlesOn(branch)).toEqual(["Intro", "Rebased"]);
    pending = "Merged";
    await f.alice.json("POST", cr(`/${number}/merge`));
    expect(await titlesOn(MAIN_BRANCH)).toEqual(["Intro", "Merged", "Rebased"]);
    expect(flushed).toEqual([branch, branch, branch]);
    await fiber.dispose();
  });

  it("commits a double-clicked merge once", async () => {
    const { branch, number } = await open(f.alice);
    await f.alice.json("POST", onBranch("/pages", branch), { title: "Guide" });
    const responses = await Promise.all([
      f.alice.call("POST", cr(`/${number}/merge`)),
      f.alice.call("POST", cr(`/${number}/merge`)),
    ]);
    expect(responses.map((response) => response.status).toSorted()).toEqual([
      200, 200,
    ]);
    const log = await f.instance.ctx.content.readLog();
    expect(
      log.filter((entry) => entry.type === CHANGE_REQUEST_MERGED),
    ).toHaveLength(1);
    expect(await titlesOn(MAIN_BRANCH)).toEqual(["Guide"]);
  });

  it("does not let viewers merge or create change requests", async () => {
    const { number } = await open(f.alice);
    await f.alice.json("POST", cr(`/${number}/request-review`));
    const merge = await errorOf(
      await f.vera.call("POST", cr(`/${number}/merge`)),
    );
    expect(merge).toMatchObject({
      status: 403,
      body: { code: "change-requests/forbidden" },
    });
    expect((await f.vera.call("POST", cr())).status).toBe(403);
    const { state } = await f.vera.json<One>("GET", cr(`/${number}`));
    expect(state).toMatchObject({
      canMerge: false,
      canApprove: false,
      canEdit: false,
    });
  });
});

describe("required approvals", () => {
  beforeEach(async () => {
    await setWorkflow({ mode: "change-requests", requiredApprovals: 1 });
  });

  it("blocks the merge until enough reviewers approve", async () => {
    const { branch, number } = await open(f.alice);
    await f.alice.json("POST", onBranch("/pages", branch), { title: "Guide" });

    const draftMerge = await errorOf(
      await f.alice.call("POST", cr(`/${number}/merge`)),
    );
    expect(draftMerge).toMatchObject({
      status: 403,
      body: { code: "change-requests/not-allowed" },
    });
    const draftApprove = await f.bob.call("POST", cr(`/${number}/approve`));
    expect(draftApprove.status).toBe(404);

    await f.alice.json("POST", cr(`/${number}/request-review`));
    expect((await f.alice.call("POST", cr(`/${number}/merge`))).status).toBe(
      403,
    );
    const self = await errorOf(
      await f.alice.call("POST", cr(`/${number}/approve`)),
    );
    expect(self).toMatchObject({
      status: 403,
      body: { code: "change-requests/not-allowed" },
    });
    expect((await f.vera.call("POST", cr(`/${number}/approve`))).status).toBe(
      403,
    );

    const bobView = await f.bob.json<One>("GET", cr(`/${number}`));
    expect(bobView.state).toMatchObject({
      canApprove: true,
      canMerge: false,
      requiredApprovals: 1,
    });

    const approved = await f.bob.json<{ changeRequest: ChangeRequest }>(
      "POST",
      cr(`/${number}/approve`),
    );
    expect(approved.changeRequest.approvals).toEqual([
      { userId: f.bob.userId, name: "Bob", at: expect.any(Number) },
    ]);
    await f.bob.json("POST", cr(`/${number}/approve`));
    const withdrawn = await f.bob.json<{ changeRequest: ChangeRequest }>(
      "DELETE",
      cr(`/${number}/approve`),
    );
    expect(withdrawn.changeRequest.approvals).toEqual([]);
    await f.bob.json("POST", cr(`/${number}/approve`));

    const aliceView = await f.alice.json<One>("GET", cr(`/${number}`));
    expect(aliceView.state).toMatchObject({
      canMerge: true,
      canApprove: false,
    });
    const merged = await f.alice.json<Landed>("POST", cr(`/${number}/merge`));
    expect(merged.changeRequest.status).toBe("merged");

    const late = await f.bob.call("POST", cr(`/${number}/approve`));
    expect(late.status).toBe(409);
  });
});

describe("approvals and new commits", () => {
  beforeEach(async () => {
    await setWorkflow({ mode: "change-requests", requiredApprovals: 1 });
  });

  it("does not count approvals given before a new commit", async () => {
    const { branch, number } = await approvedByBob();
    await f.alice.json("POST", onBranch("/pages", branch), { title: "More" });
    await expectNotMergeable(number);

    await f.bob.json("POST", cr(`/${number}/approve`));
    const merged = await f.alice.json<Landed>("POST", cr(`/${number}/merge`));
    expect(merged.changeRequest.status).toBe("merged");
    expect(await titlesOn(MAIN_BRANCH)).toEqual(["Guide", "More"]);
  });

  it("does not count approvals given before an update from main", async () => {
    await seed(["Intro"]);
    const { number } = await approvedByBob();
    await seed(["Other"]);
    await f.alice.json("POST", cr(`/${number}/rebase`));
    await expectNotMergeable(number);
  });

  it("does not count approvals when unsaved edits land at merge time", async () => {
    const { branch, number } = await approvedByBob();
    const fiber = await f.instance.ctx.plugin({
      name: "pending-edits",
      inject: ["content"],
      apply(ctx: Context) {
        ctx.on("content/flush", async ({ spaceId }) => {
          const head = await ctx.content.head(spaceId, branch);
          await ctx.content.commit({
            spaceId,
            branch,
            parent: head?.id,
            put: { [createId()]: page("Late") },
            message: "Shared edit",
            author: f.alice.userId,
          });
        });
      },
    });
    const merge = await errorOf(
      await f.alice.call("POST", cr(`/${number}/merge`)),
    );
    expect(merge).toMatchObject({
      status: 403,
      body: { code: "change-requests/not-allowed" },
    });
    expect(await titlesOn(MAIN_BRANCH)).toEqual([]);
    await fiber.dispose();
  });
});

describe("required checks", () => {
  const PLUGIN = "acme-checks";

  async function withChecks(
    report: (input: ChangeRequestChecksInput) => void | Promise<void>,
  ): Promise<ChangeRequestChecksInput[]> {
    const seen: ChangeRequestChecksInput[] = [];
    await f.instance.ctx.plugin({
      name: PLUGIN,
      apply(ctx: Context) {
        ctx.on("change-request/checks", async (input) => {
          seen.push(input);
          await report(input);
        });
      },
    });
    return seen;
  }

  it("asks for the checks of the branch head and lists them", async () => {
    const seen = await withChecks((input) => {
      input.report(lint("success"));
      input.report({
        name: "acme.links",
        title: "Links",
        status: "pending",
        isRequired: false,
        summary: "Still crawling",
        url: "https://ci.example.com/links",
      });
    });
    const { branch, number } = await inReview();
    const { state } = await f.alice.json<One>("GET", cr(`/${number}`));
    const head = await f.instance.ctx.content.head(f.spaceId, branch);
    expect(seen.at(-1)).toMatchObject({
      spaceId: f.spaceId,
      number,
      branch,
      head: head?.id,
    });
    expect(state.checks.map((check) => check.name)).toEqual([
      "acme.links",
      "acme.lint",
    ]);
    expect(state.canMerge).toBe(true);
  });

  it("blocks the merge until required checks succeed", async () => {
    let status: MergeCheck["status"] = "pending";
    await withChecks((input) => {
      input.report(lint(status));
    });
    const { number } = await inReview();
    await expectBlocked(number);

    status = "failure";
    await expectBlocked(number);

    status = "success";
    const merged = await f.alice.json<Landed>("POST", cr(`/${number}/merge`));
    expect(merged.changeRequest.status).toBe("merged");
    expect(await titlesOn(MAIN_BRANCH)).toEqual(["Guide"]);
    const { state } = await f.alice.json<One>("GET", cr(`/${number}`));
    expect(state.checks).toEqual([]);
  });

  it("does not block on checks that are not required", async () => {
    await withChecks((input) => {
      input.report(lint("failure", false));
    });
    const { number } = await inReview();
    const merged = await f.alice.json<Landed>("POST", cr(`/${number}/merge`));
    expect(merged.changeRequest.status).toBe("merged");
  });

  it("turns a failing listener into a failed required check", async () => {
    await withChecks(() => {
      throw new Error("lint crashed");
    });
    const { number } = await inReview();
    const checks = await expectBlocked(number);
    expect(checks).toEqual([
      expect.objectContaining({
        name: "change-requests.check-error",
        status: "failure",
        isRequired: true,
      }),
    ]);
  });

  it("turns invalid and duplicate reports into a failed required check", async () => {
    await withChecks((input) => {
      input.report(lint("success"));
      input.report(lint("success"));
      input.report({ ...lint("success"), name: "lint" });
    });
    const { number } = await inReview();
    const checks = await expectBlocked(number);
    expect(checks.map((check) => check.name)).toEqual([
      "acme.lint",
      "change-requests.check-error",
    ]);
    expect(checks[1]?.summary).toBe(
      "The check acme.lint was reported twice. A check reported an invalid result.",
    );
  });

  it("asks only the plugins enabled in the space", async () => {
    const seen = await withChecks((input) => {
      input.report(lint("failure"));
    });
    await f.instance.ctx.installations.install(PLUGIN);
    await f.instance.ctx.installations.setEnabled(
      PLUGIN,
      { kind: "space", orgId: f.orgId, spaceId: f.spaceId },
      false,
    );
    const { number } = await inReview();
    const merged = await f.alice.json<Landed>("POST", cr(`/${number}/merge`));
    expect(merged.changeRequest.status).toBe("merged");
    expect(seen).toEqual([]);
  });
});

describe("rebasing and conflicts", () => {
  it("updates a change request from main without conflicts", async () => {
    const [a = "", b = ""] = await seed(["A", "B"]);
    const first = await open(f.alice);
    const second = await open(f.bob);
    await rename(f.alice, first.branch, a, "A1");
    await rename(f.bob, second.branch, b, "B2");

    const noop = await f.bob.json<Landed>(
      "POST",
      cr(`/${second.number}/rebase`),
    );
    const before = await f.instance.ctx.content.head(f.spaceId, second.branch);
    expect(noop.head).toBe(before?.id);

    await f.alice.json("POST", cr(`/${first.number}/merge`));
    const behind = await f.bob.json<One>("GET", cr(`/${second.number}`));
    expect(behind.state).toMatchObject({ isBehind: true, conflicts: 0 });

    const rebased = await f.bob.json<Landed>(
      "POST",
      cr(`/${second.number}/rebase`),
    );
    const main = await f.instance.ctx.content.head(f.spaceId);
    const branch = await f.instance.ctx.content.getBranch(
      f.spaceId,
      second.branch,
    );
    expect(branch).toMatchObject({ head: rebased.head, base: main?.id });
    expect(await titlesOn(second.branch)).toEqual(["A1", "B2"]);
    const after = await f.bob.json<One>("GET", cr(`/${second.number}`));
    expect(after.state.isBehind).toBe(false);

    const { changes } = await f.bob.json<{ changes: EntryChange[] }>(
      "GET",
      cr(`/${second.number}/changes`),
    );
    expect(changes).toEqual([{ entryId: b, title: "B2", kind: "changed" }]);

    await f.bob.json("POST", cr(`/${second.number}/merge`));
    expect(await titlesOn(MAIN_BRANCH)).toEqual(["A1", "B2"]);
  });

  it("reports a conflict, takes resolutions and merges", async () => {
    const [a = ""] = await seed(["A"]);
    const first = await open(f.alice);
    const second = await open(f.bob);
    await rename(f.alice, first.branch, a, "One");
    await rename(f.bob, second.branch, a, "Two");
    await f.alice.json("POST", cr(`/${first.number}/merge`));

    const { state } = await f.bob.json<One>("GET", cr(`/${second.number}`));
    expect(state).toMatchObject({
      isBehind: true,
      conflicts: 1,
      canMerge: false,
    });

    const merge = await errorOf(
      await f.bob.call("POST", cr(`/${second.number}/merge`)),
    );
    expect(merge.status).toBe(409);
    expect(merge.body.code).toBe("change-requests/merge-conflict");
    expect(merge.body.conflicts).toEqual([
      expect.objectContaining({
        kind: "entry",
        entryId: a,
        field: "title",
        ours: "One",
        theirs: "Two",
      }),
    ]);
    const rebase = await errorOf(
      await f.bob.call("POST", cr(`/${second.number}/rebase`)),
    );
    expect(rebase.body.code).toBe("change-requests/merge-conflict");

    const view = await f.bob.json<ConflictsView>(
      "GET",
      cr(`/${second.number}/conflicts`),
    );
    const main = await f.instance.ctx.content.head(f.spaceId);
    expect(view.main).toBe(main?.id);
    expect(view.resolutions).toEqual({});
    const [conflict] = view.conflicts;
    if (!conflict) throw new Error("expected a conflict");

    const invalid = await f.bob.call(
      "PUT",
      cr(`/${second.number}/resolutions`),
      { resolutions: { [conflict.id]: { take: "mine" } } },
    );
    expect(invalid.status).toBe(400);

    const resolved = await f.bob.json<ConflictsView>(
      "PUT",
      cr(`/${second.number}/resolutions`),
      { resolutions: { [conflict.id]: { value: "One and two" } } },
    );
    expect(resolved).toEqual({
      main: main?.id,
      conflicts: [],
      resolutions: { [conflict.id]: { value: "One and two" } },
    });
    const ready = await f.bob.json<One>("GET", cr(`/${second.number}`));
    expect(ready.state).toMatchObject({ conflicts: 0, canMerge: true });

    await f.bob.json("POST", cr(`/${second.number}/merge`));
    expect(await titlesOn(MAIN_BRANCH)).toEqual(["One and two"]);
  });

  it("resolves a conflict while rebasing and clears the resolutions", async () => {
    const [a = ""] = await seed(["A"]);
    const first = await open(f.alice);
    const second = await open(f.bob);
    await rename(f.alice, first.branch, a, "One");
    await rename(f.bob, second.branch, a, "Two");
    await f.alice.json("POST", cr(`/${first.number}/merge`));

    const view = await f.bob.json<ConflictsView>(
      "GET",
      cr(`/${second.number}/conflicts`),
    );
    const [conflict] = view.conflicts;
    if (!conflict) throw new Error("expected a conflict");
    await f.bob.json("PUT", cr(`/${second.number}/resolutions`), {
      resolutions: { [conflict.id]: { take: "theirs" } },
    });
    await f.bob.json("POST", cr(`/${second.number}/rebase`));
    expect(await titlesOn(second.branch)).toEqual(["Two"]);
    const after = await f.bob.json<ConflictsView>(
      "GET",
      cr(`/${second.number}/conflicts`),
    );
    expect(after).toMatchObject({ conflicts: [], resolutions: {} });
  });
});

describe("closing", () => {
  it("closes a change request and deletes its branch", async () => {
    const { branch, number } = await open(f.alice);
    await f.alice.json("POST", onBranch("/pages", branch), { title: "Guide" });
    await f.alice.json("POST", cr(`/${number}/request-review`));

    expect((await f.bob.call("POST", cr(`/${number}/close`))).status).toBe(403);
    const { changeRequest } = await f.alice.json<{
      changeRequest: ChangeRequest;
    }>("POST", cr(`/${number}/close`));
    expect(changeRequest.status).toBe("closed");
    expect(
      await f.instance.ctx.content.getBranch(f.spaceId, branch),
    ).toBeUndefined();
    expect(await titlesOn(MAIN_BRANCH)).toEqual([]);

    const again = await errorOf(
      await f.alice.call("POST", cr(`/${number}/close`)),
    );
    expect(again).toMatchObject({
      status: 409,
      body: { code: "change-requests/invalid-state" },
    });
    expect((await f.alice.call("POST", cr(`/${number}/merge`))).status).toBe(
      403,
    );

    const { changes } = await f.alice.json<{ changes: EntryChange[] }>(
      "GET",
      cr(`/${number}/changes`),
    );
    expect(changes).toEqual([
      expect.objectContaining({ title: "Guide", kind: "added" }),
    ]);
  });

  it("lets a space admin close someone else's change request", async () => {
    const { number } = await open(f.alice);
    await f.alice.json("POST", cr(`/${number}/request-review`));
    const response = await f.owner.call("POST", cr(`/${number}/close`));
    expect(response.status).toBe(200);
  });
});

describe("listing and visibility", () => {
  it("hides drafts from everyone but their author", async () => {
    const draft = await open(f.alice, "Draft");
    const ready = await open(f.alice, "Ready");
    await f.alice.json("POST", cr(`/${ready.number}/request-review`));

    const list = async (user: Client, status = "") =>
      (
        await user.json<{ changeRequests: ChangeRequest[] }>(
          "GET",
          cr(status === "" ? "" : `?status=${status}`),
        )
      ).changeRequests.map((item) => item.title);

    expect(await list(f.alice)).toEqual(["Ready", "Draft"]);
    expect(await list(f.bob)).toEqual(["Ready"]);
    expect(await list(f.vera, "draft")).toEqual([]);
    expect((await f.bob.call("GET", cr(`/${draft.number}`))).status).toBe(404);
    expect(
      (await f.bob.call("GET", cr(`/${draft.number}/changes`))).status,
    ).toBe(404);

    await f.alice.json("POST", cr(`/${draft.number}/request-review`));
    expect((await f.bob.call("GET", cr(`/${draft.number}`))).status).toBe(200);

    await f.alice.json("POST", cr(`/${draft.number}/close`));
    expect(await list(f.bob)).toEqual(["Ready"]);
    expect(await list(f.bob, "closed")).toEqual(["Draft"]);
    expect(await list(f.bob, "all")).toEqual(["Ready", "Draft"]);
    expect((await f.bob.call("GET", cr("?status=nope"))).status).toBe(400);
  });

  it("shows drafts to space admins", async () => {
    const draft = await open(f.alice, "Draft");
    const admin = await f.createUser("Adam", "admin");
    for (const user of [f.owner, admin]) {
      const { changeRequests } = await user.json<{
        changeRequests: ChangeRequest[];
      }>("GET", cr("?status=draft"));
      expect(changeRequests.map((item) => item.title)).toEqual(["Draft"]);
      const one = await user.json<One>("GET", cr(`/${draft.number}`));
      expect(one.changeRequest.title).toBe("Draft");
      expect(
        (await user.call("GET", cr(`/${draft.number}/changes`))).status,
      ).toBe(200);
    }
    expect((await f.bob.call("GET", cr(`/${draft.number}`))).status).toBe(404);
  });

  it("answers 404 for unknown change requests", async () => {
    for (const path of ["/7", "/0", "/abc", "/7/changes"]) {
      const response = await errorOf(await f.alice.call("GET", cr(path)));
      expect(response).toMatchObject({
        status: 404,
        body: { code: "change-requests/not-found" },
      });
    }
  });

  it("checks access to the space before anything else", async () => {
    const outsider = await f.createUser("Olga", undefined);
    const response = await errorOf(await outsider.call("GET", cr()));
    expect(response).toMatchObject({
      status: 403,
      body: { code: "change-requests/forbidden" },
    });
  });
});

describe("enablement", () => {
  it("answers 404 when the plugin is not enabled for the space", async () => {
    const other = await f.createSpace("other", false);
    const base = `/api/orgs/${f.orgId}/spaces/${other}`;
    for (const [method, path] of [
      ["GET", `${base}/change-requests`],
      ["POST", `${base}/change-requests`],
      ["GET", `${base}/change-requests/1`],
      ["POST", `${base}/change-requests/1/merge`],
      ["GET", `${base}/change-request-workflow`],
    ] as const) {
      const response = await errorOf(await f.owner.call(method, path));
      expect(response).toMatchObject({
        status: 404,
        body: { code: "change-requests/not-enabled" },
      });
    }
  });
});
