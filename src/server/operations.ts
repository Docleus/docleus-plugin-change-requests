import {
  DocleusError,
  MAIN_BRANCH,
  type Actor,
  type Branch,
  type Context,
  type EntrySet,
  type MergeConflict,
  type MergeResolution,
  type Revision,
  type Space,
} from "@docleus/sdk";
import type {
  ChangeRequest,
  ChangeRequestState,
  EntryChange,
} from "../shared/index.ts";
import { areRequiredChecksPassing, collectChecks } from "./checks.ts";
import { diffEntrySets, entryChanges, toEntrySet } from "./diff.ts";
import { createKeyedSerializer } from "./respond.ts";
import type { StoredChangeRequest, ChangeRequestStore } from "./store.ts";
import type { StatusFilter } from "./validate.ts";
import type { WorkflowStore } from "./workflow.ts";

/** The content-log type appended when a change request is merged. */
export const CHANGE_REQUEST_MERGED = "change-request/merged";

/** Payload of a {@link CHANGE_REQUEST_MERGED} log entry. */
export interface ChangeRequestMerged {
  readonly spaceId: string;
  readonly number: number;
  /** The merge revision on `main`. */
  readonly revision: string;
  readonly branch: string;
}

/** The signed-in caller, resolved once per request. */
export interface Caller {
  readonly actor: Actor;
  readonly userId: string;
  readonly name: string;
  /** `manage` on the space. */
  readonly isSpaceAdmin: boolean;
  /** `write` on the space. */
  readonly canWrite: boolean;
}

export interface ConflictsView {
  readonly main: string | null;
  readonly conflicts: readonly MergeConflict[];
  readonly resolutions: Readonly<Record<string, MergeResolution>>;
}

export interface Landed {
  readonly changeRequest: ChangeRequest;
  readonly head: string | null;
}

export function isConflicted(
  result: Landed | Conflicted,
): result is Conflicted {
  return "conflicts" in result;
}

/**
 * The change request as callers see it: only approvals given for `head`
 * count, so a new commit or an update from `main` asks for review again.
 */
export function present(
  stored: StoredChangeRequest,
  head: string | undefined,
): ChangeRequest {
  const { final: _final, approvals, ...changeRequest } = stored;
  return {
    ...changeRequest,
    approvals: approvals
      .filter((approval) => head !== undefined && approval.head === head)
      .map(({ head: _head, ...approval }) => approval),
  };
}

function isActive(cr: ChangeRequest): boolean {
  return cr.status === "draft" || cr.status === "open";
}

function notFound(number: number): DocleusError {
  return new DocleusError(
    "change-requests/not-found",
    `change request #${number} does not exist`,
  );
}

function invalidState(cr: ChangeRequest, action: string): DocleusError {
  return new DocleusError(
    "change-requests/invalid-state",
    `cannot ${action} change request #${cr.number}: it is ${cr.status}`,
  );
}

function notAllowed(message: string): DocleusError {
  return new DocleusError("change-requests/not-allowed", message);
}

/** A merge or rebase that stopped at unresolved conflicts. */
export interface Conflicted {
  readonly conflicts: readonly MergeConflict[];
}

const STATUSES_BY_FILTER: Record<
  StatusFilter,
  readonly ChangeRequest["status"][] | undefined
> = {
  active: ["draft", "open"],
  draft: ["draft"],
  open: ["open"],
  merged: ["merged"],
  closed: ["closed"],
  all: undefined,
};

interface MergePlan {
  readonly mainHead: Revision | undefined;
  readonly branch: Branch;
  readonly branchHead: Revision | undefined;
  readonly isBehind: boolean;
  readonly ours: EntrySet;
  readonly theirs: EntrySet;
  readonly merged: EntrySet;
  readonly conflicts: readonly MergeConflict[];
}

export interface ChangeRequestOperations {
  list(
    space: Space,
    caller: Caller,
    filter: StatusFilter,
  ): Promise<ChangeRequest[]>;
  create(space: Space, caller: Caller, title: string): Promise<ChangeRequest>;
  /** Someone else's draft is not found, unless the caller is a space admin. */
  get(space: Space, caller: Caller, number: number): Promise<ChangeRequest>;
  state(
    space: Space,
    caller: Caller,
    cr: ChangeRequest,
  ): Promise<ChangeRequestState>;
  update(
    space: Space,
    caller: Caller,
    number: number,
    patch: { title?: string; description?: string },
  ): Promise<ChangeRequest>;
  requestReview(
    space: Space,
    caller: Caller,
    number: number,
  ): Promise<ChangeRequest>;
  approve(
    space: Space,
    caller: Caller,
    number: number,
    isApproved: boolean,
  ): Promise<ChangeRequest>;
  close(space: Space, caller: Caller, number: number): Promise<ChangeRequest>;
  changes(
    space: Space,
    caller: Caller,
    number: number,
    options?: { readonly withBodies?: boolean },
  ): Promise<EntryChange[]>;
  conflicts(
    space: Space,
    caller: Caller,
    number: number,
  ): Promise<ConflictsView>;
  setResolutions(
    space: Space,
    caller: Caller,
    number: number,
    resolutions: Readonly<Record<string, MergeResolution>>,
  ): Promise<ConflictsView>;
  rebase(
    space: Space,
    caller: Caller,
    number: number,
  ): Promise<Landed | Conflicted>;
  merge(
    space: Space,
    caller: Caller,
    number: number,
  ): Promise<Landed | Conflicted>;
}

function canEdit(caller: Caller, cr: ChangeRequest): boolean {
  return (
    caller.canWrite && (cr.author === caller.userId || caller.isSpaceAdmin)
  );
}

function assertCanEdit(caller: Caller, cr: ChangeRequest): void {
  if (!canEdit(caller, cr)) {
    throw notAllowed(
      "only the author or a space admin can change this change request",
    );
  }
}

export function createOperations(
  ctx: Context,
  store: ChangeRequestStore,
  workflows: WorkflowStore,
  now: () => number,
): ChangeRequestOperations {
  // Every write to a space's change requests runs in order, so a double
  // click cannot merge or rebase twice and numbers are allocated once.
  const serial = createKeyedSerializer();
  const inSpace = <T>(space: Space, task: () => Promise<T>) =>
    serial(space.id, task);

  async function entriesOf(revision: string | undefined): Promise<EntrySet> {
    if (revision === undefined) return {};
    return toEntrySet(await ctx.content.listEntries(revision));
  }

  async function visible(
    space: Space,
    caller: Caller,
    number: number,
  ): Promise<StoredChangeRequest> {
    const cr = await store.get(space.id, number);
    if (!cr || !isVisibleTo(caller, cr)) throw notFound(number);
    return cr;
  }

  /** The head approvals must match: the branch head, or the final one. */
  async function headOf(
    space: Space,
    cr: StoredChangeRequest,
  ): Promise<string | undefined> {
    if (cr.final) return cr.final.head;
    return (await ctx.content.getBranch(space.id, cr.branch))?.head;
  }

  async function show(
    space: Space,
    cr: StoredChangeRequest,
  ): Promise<ChangeRequest> {
    return present(cr, await headOf(space, cr));
  }

  async function branchOf(space: Space, cr: ChangeRequest): Promise<Branch> {
    const branch = await ctx.content.getBranch(space.id, cr.branch);
    if (!branch) {
      throw new DocleusError(
        "change-requests/branch-not-found",
        `the branch "${cr.branch}" of change request #${cr.number} does not exist`,
      );
    }
    return branch;
  }

  // Shared editing sessions hold changes the branch head does not have yet.
  async function flush(space: Space, cr: ChangeRequest): Promise<void> {
    const scope = await ctx.installations.scope({
      kind: "space",
      orgId: space.orgId,
      spaceId: space.id,
    });
    await ctx.parallel(scope, "content/flush", {
      spaceId: space.id,
      branch: cr.branch,
    });
  }

  async function plan(
    space: Space,
    cr: ChangeRequest,
    resolutions: Readonly<Record<string, MergeResolution>>,
  ): Promise<MergePlan> {
    const branch = await branchOf(space, cr);
    const mainHead = await ctx.content.head(space.id, MAIN_BRANCH);
    const branchHead =
      branch.head === undefined
        ? undefined
        : await ctx.content.getRevision(branch.head);
    const isBehind = mainHead?.id !== branch.base;
    const [base, ours, theirs] = await Promise.all([
      entriesOf(branch.base),
      entriesOf(mainHead?.id),
      entriesOf(branch.head),
    ]);
    if (!isBehind) {
      return {
        mainHead,
        branch,
        branchHead,
        isBehind,
        ours,
        theirs,
        merged: theirs,
        conflicts: [],
      };
    }
    const result = ctx.content.merge({ base, ours, theirs, resolutions });
    return {
      mainHead,
      branch,
      branchHead,
      isBehind,
      ours,
      theirs,
      merged: result.entries,
      conflicts: result.conflicts,
    };
  }

  async function conflictsView(
    space: Space,
    cr: StoredChangeRequest,
  ): Promise<ConflictsView> {
    if (!isActive(cr)) throw invalidState(cr, "resolve conflicts of");
    await flush(space, cr);
    const resolutions = await store.resolutions(space.id, cr.number);
    const planned = await plan(space, cr, resolutions);
    return {
      main: planned.mainHead?.id ?? null,
      conflicts: planned.conflicts,
      resolutions,
    };
  }

  async function finish(space: Space, cr: StoredChangeRequest): Promise<void> {
    const branch = await ctx.content.getBranch(space.id, cr.branch);
    if (branch && cr.final && branch.head !== cr.final.head) {
      throw invalidState(cr, "remove a branch changed after merging");
    }
    try {
      await ctx.content.deleteBranch(space.id, cr.branch);
    } catch (error) {
      if (
        !(error instanceof DocleusError) ||
        error.code !== "content/branch-not-found"
      ) {
        throw error;
      }
    }
    await store.setResolutions(space.id, cr.number, {});
  }

  async function mergedRevision(
    space: Space,
    cr: StoredChangeRequest,
    branch: Branch,
  ): Promise<Revision | undefined> {
    let revision = await ctx.content.head(space.id, MAIN_BRANCH);
    while (revision) {
      if (revision.merged !== undefined) {
        const merged = await ctx.content.getRevision(revision.merged);
        if (merged?.spaceId === space.id && merged.branch === cr.branch) {
          if (merged.id !== branch.head) {
            throw new DocleusError(
              "change-requests/invalid-state",
              `change request #${cr.number} changed after its merge; retain the branch for recovery`,
            );
          }
          return revision;
        }
      }
      if (revision.id === branch.base) break;
      revision = revision.parent
        ? await ctx.content.getRevision(revision.parent)
        : undefined;
    }
    return undefined;
  }

  async function mergeRecorded(revision: string): Promise<boolean> {
    let afterSeq = 0;
    for (;;) {
      const entries = await ctx.content.readLog({ afterSeq, limit: 1000 });
      for (const entry of entries) {
        const payload = entry.payload;
        if (
          entry.type === CHANGE_REQUEST_MERGED &&
          payload !== null &&
          typeof payload === "object" &&
          "revision" in payload &&
          payload.revision === revision
        )
          return true;
        afterSeq = entry.seq;
      }
      if (entries.length < 1000) return false;
    }
  }

  async function completeMerge(
    space: Space,
    cr: StoredChangeRequest,
    branch: Branch,
    revision: Revision,
    recovering: boolean,
  ): Promise<Landed> {
    if (!recovering || !(await mergeRecorded(revision.id))) {
      const payload: ChangeRequestMerged = {
        spaceId: space.id,
        number: cr.number,
        revision: revision.id,
        branch: cr.branch,
      };
      await ctx.content.append(CHANGE_REQUEST_MERGED, payload);
    }
    const done = await store.update(space.id, cr.number, {
      status: "merged",
      mergedAt: revision.at,
      mergedBy: revision.author,
      mergedRevision: revision.id,
      final: { base: branch.base, head: branch.head },
    });
    await finish(space, done);
    return { changeRequest: present(done, branch.head), head: revision.id };
  }

  return {
    async list(space, caller, filter) {
      const all = await store.list(space.id, {
        statuses: STATUSES_BY_FILTER[filter],
      });
      return Promise.all(
        all
          .filter((cr) => isVisibleTo(caller, cr))
          .map((cr) => show(space, cr)),
      );
    },

    create(space, caller, title) {
      return inSpace(space, async () => {
        const cr = await store.create({
          spaceId: space.id,
          title,
          author: caller.userId,
          authorName: caller.name,
        });
        try {
          await ctx.content.createBranch({
            spaceId: space.id,
            name: cr.branch,
          });
        } catch (error) {
          await store.discard(space.id, cr.number);
          throw error;
        }
        return present(cr, undefined);
      });
    },

    async get(space, caller, number) {
      return show(space, await visible(space, caller, number));
    },

    async state(space, caller, cr) {
      // `cr` is what `get` returned: its approvals already match the head.
      const { workflow } = await workflows.get({
        kind: "space",
        orgId: space.orgId,
        spaceId: space.id,
      });
      const requiredApprovals = workflow.requiredApprovals;
      const base = {
        requiredApprovals,
        canEdit: isActive(cr) && canEdit(caller, cr),
      };
      if (!isActive(cr)) {
        return {
          ...base,
          isBehind: false,
          conflicts: 0,
          checks: [],
          canMerge: false,
          canApprove: false,
        };
      }
      const resolutions = await store.resolutions(space.id, cr.number);
      const planned = await plan(space, cr, resolutions);
      const checks = await collectChecks(ctx, space, cr, planned.branch);
      return {
        ...base,
        isBehind: planned.isBehind,
        conflicts: planned.conflicts.length,
        checks,
        canMerge:
          caller.canWrite &&
          isMergeAllowed(cr, requiredApprovals) &&
          areRequiredChecksPassing(checks) &&
          planned.conflicts.length === 0,
        canApprove:
          caller.canWrite &&
          cr.status === "open" &&
          cr.author !== caller.userId,
      };
    },

    update(space, caller, number, patch) {
      return inSpace(space, async () => {
        const cr = await visible(space, caller, number);
        assertCanEdit(caller, cr);
        return show(space, await store.update(space.id, number, patch));
      });
    },

    requestReview(space, caller, number) {
      return inSpace(space, async () => {
        const cr = await visible(space, caller, number);
        assertCanEdit(caller, cr);
        if (cr.status !== "draft") throw invalidState(cr, "request review of");
        return show(
          space,
          await store.update(space.id, number, { status: "open" }),
        );
      });
    },

    approve(space, caller, number, isApproved) {
      return inSpace(space, async () => {
        const cr = await visible(space, caller, number);
        if (cr.status !== "open") {
          throw invalidState(
            cr,
            isApproved ? "approve" : "withdraw approval of",
          );
        }
        if (cr.author === caller.userId) {
          throw notAllowed("authors cannot approve their own change requests");
        }
        const head = await headOf(space, cr);
        if (isApproved) {
          await store.approve(space.id, number, {
            userId: caller.userId,
            name: caller.name,
            at: now(),
            head: head ?? null,
          });
        } else {
          await store.withdraw(space.id, number, caller.userId);
        }
        return present(await store.update(space.id, number, {}), head);
      });
    },

    close(space, caller, number) {
      return inSpace(space, async () => {
        const cr = await visible(space, caller, number);
        assertCanEdit(caller, cr);
        if (!isActive(cr)) throw invalidState(cr, "close");
        const branch = await branchOf(space, cr);
        const closed = await store.update(space.id, number, {
          status: "closed",
          final: { base: branch.base, head: branch.head },
        });
        await finish(space, cr);
        return present(closed, branch.head);
      });
    },

    async changes(space, caller, number, options = {}) {
      const cr = await visible(space, caller, number);
      const range = cr.final ?? (await branchOf(space, cr));
      const [baseRevision, headRevision] = await Promise.all([
        range.base === undefined
          ? undefined
          : ctx.content.getRevision(range.base),
        range.head === undefined
          ? undefined
          : ctx.content.getRevision(range.head),
      ]);
      const [base, head] = await Promise.all([
        entriesOf(baseRevision?.id),
        entriesOf(headRevision?.id),
      ]);
      const changes = entryChanges(
        base,
        head,
        (entryId) =>
          baseRevision !== undefined &&
          headRevision !== undefined &&
          baseRevision.entries[entryId] === headRevision.entries[entryId],
      );
      if (!options.withBodies) return changes;
      return changes.map((change) => ({
        ...change,
        before: base[change.entryId]?.body,
        after: head[change.entryId]?.body,
      }));
    },

    async conflicts(space, caller, number) {
      return conflictsView(space, await visible(space, caller, number));
    },

    setResolutions(space, caller, number, resolutions) {
      return inSpace(space, async () => {
        const cr = await visible(space, caller, number);
        if (!isActive(cr)) throw invalidState(cr, "resolve conflicts of");
        await store.setResolutions(space.id, number, resolutions);
        return conflictsView(space, cr);
      });
    },

    rebase(space, caller, number) {
      return inSpace(space, async () => {
        const cr = await visible(space, caller, number);
        if (!isActive(cr)) throw invalidState(cr, "update");
        await flush(space, cr);
        const resolutions = await store.resolutions(space.id, number);
        const planned = await plan(space, cr, resolutions);
        if (!planned.isBehind) {
          return {
            changeRequest: present(cr, planned.branch.head),
            head: planned.branch.head ?? null,
          };
        }
        if (planned.conflicts.length > 0) {
          return { conflicts: planned.conflicts };
        }
        const mainHead = planned.mainHead;
        if (mainHead === undefined) {
          throw new DocleusError(
            "change-requests/invalid-state",
            `${MAIN_BRANCH} has no revision to update from`,
          );
        }
        const diff = diffEntrySets(planned.theirs, planned.merged);
        const revision = await ctx.content.commit({
          spaceId: space.id,
          branch: cr.branch,
          parent: planned.branch.head,
          put: diff.put,
          remove: diff.remove,
          message: `Update change request #${number} from ${MAIN_BRANCH}`,
          author: caller.userId,
          rebase: mainHead.id,
        });
        await store.setResolutions(space.id, number, {});
        return {
          changeRequest: present(
            await store.update(space.id, number, {}),
            revision.id,
          ),
          head: revision.id,
        };
      });
    },

    merge(space, caller, number) {
      return inSpace(space, async () => {
        const stored = await visible(space, caller, number);
        if (stored.status === "merged" && stored.mergedRevision) {
          await finish(space, stored);
          return {
            changeRequest: present(stored, stored.final?.head),
            head: stored.mergedRevision,
          };
        }
        if (isActive(stored)) {
          const branch = await branchOf(space, stored);
          const landed = await mergedRevision(space, stored, branch);
          if (landed) return completeMerge(space, stored, branch, landed, true);
        }
        const { workflow } = await workflows.get({
          kind: "space",
          orgId: space.orgId,
          spaceId: space.id,
        });
        const assertMergeAllowed = (cr: ChangeRequest) => {
          if (!isMergeAllowed(cr, workflow.requiredApprovals)) {
            throw notAllowed(
              isActive(cr)
                ? `change request #${number} needs ${workflow.requiredApprovals} approval(s) of its latest changes and review before it can be merged`
                : `change request #${number} is ${cr.status}`,
            );
          }
        };
        assertMergeAllowed(await show(space, stored));
        await flush(space, stored);
        const resolutions = await store.resolutions(space.id, number);
        const planned = await plan(space, stored, resolutions);
        // The flush may have moved the head past what reviewers approved.
        const cr = present(stored, planned.branch.head);
        assertMergeAllowed(cr);
        if (planned.conflicts.length > 0) {
          return { conflicts: planned.conflicts };
        }
        const checks = await collectChecks(ctx, space, cr, planned.branch);
        if (!areRequiredChecksPassing(checks)) {
          throw new DocleusError(
            "change-requests/checks-failed",
            `change request #${number} cannot be merged until its required checks pass`,
          );
        }
        const merged = planned.branch.head;
        if (merged === undefined) {
          throw new DocleusError(
            "change-requests/invalid-state",
            `change request #${number} has no changes to merge`,
          );
        }
        const diff = diffEntrySets(planned.ours, planned.merged);
        const revision = await ctx.content.commit({
          spaceId: space.id,
          branch: MAIN_BRANCH,
          parent: planned.mainHead?.id,
          put: diff.put,
          remove: diff.remove,
          message: `Merge change request #${number}: ${cr.title}`,
          author: caller.userId,
          merged,
        });
        return completeMerge(space, stored, planned.branch, revision, false);
      });
    },
  };
}

function isVisibleTo(caller: Caller, cr: ChangeRequest): boolean {
  return (
    cr.status !== "draft" || cr.author === caller.userId || caller.isSpaceAdmin
  );
}

/** Status and approvals allow a merge; conflicts and checks are checked separately. */
export function isMergeAllowed(
  cr: ChangeRequest,
  requiredApprovals: number,
): boolean {
  if (requiredApprovals > 0) {
    return cr.status === "open" && cr.approvals.length >= requiredApprovals;
  }
  return cr.status === "draft" || cr.status === "open";
}
