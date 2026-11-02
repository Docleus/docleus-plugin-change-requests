import type { BlockNode, MergeCheck } from "@docleus/sdk";

/** The plugin's package and manifest name. */
export const PLUGIN_NAME = "@docleus/plugin-change-requests";

/** `draft` and `open` are active; `merged` and `closed` are final. */
export type ChangeRequestStatus = "draft" | "open" | "merged" | "closed";

/** An approval of the branch head it was given for; a new commit drops it. */
export interface Approval {
  readonly userId: string;
  readonly name: string;
  readonly at: number;
}

/** A proposed set of edits to a space, made on its own branch. */
export interface ChangeRequest {
  readonly spaceId: string;
  /** Per space, from 1. */
  readonly number: number;
  readonly title: string;
  readonly description: string;
  readonly status: ChangeRequestStatus;
  /** The author's user id. */
  readonly author: string;
  readonly authorName: string;
  /** `cr/<number>`. */
  readonly branch: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly mergedAt: number | undefined;
  readonly mergedBy: string | undefined;
  readonly mergedRevision: string | undefined;
  readonly approvals: readonly Approval[];
}

/** What a change request allows right now, for the caller. */
export interface ChangeRequestState {
  /** Main's head is not the branch base. */
  readonly isBehind: boolean;
  /** Unresolved conflicts when merging into the current main. */
  readonly conflicts: number;
  readonly requiredApprovals: number;
  /** Reported by plugins for the branch head, sorted by name; empty once merged or closed. */
  readonly checks: readonly MergeCheck[];
  readonly canMerge: boolean;
  readonly canApprove: boolean;
  /** Author or space admin: edit the title and description, request review, close. */
  readonly canEdit: boolean;
}

export type WorkflowMode = "change-requests" | "direct";

export interface WorkflowSettings {
  readonly mode: WorkflowMode;
  readonly requiredApprovals: number;
}

export const DEFAULT_WORKFLOW: WorkflowSettings = {
  mode: "change-requests",
  requiredApprovals: 0,
};

/** How one entry differs between the branch base and the branch head. */
export interface EntryChange {
  readonly entryId: string;
  readonly title: string;
  readonly kind: "added" | "removed" | "changed" | "moved";
  /** With `?bodies=1`: the page body at the branch base and at its head. */
  readonly before?: BlockNode | undefined;
  readonly after?: BlockNode | undefined;
}

/** The branch of change request `number`. */
export function branchOf(number: number): string {
  return `cr/${number}`;
}

/** The change request number of a `cr/<number>` branch, or `undefined`. */
export function numberOfBranch(branch: string): number | undefined {
  const match = /^cr\/([1-9][0-9]*)$/.exec(branch);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}
