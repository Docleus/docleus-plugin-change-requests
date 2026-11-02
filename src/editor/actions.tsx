import { fullTime, relativeTime } from "@docleus/sdk";
import type { ChangeRequest, ChangeRequestStatus } from "../shared/index.ts";
import {
  crPath,
  type Api,
  type ChangeRequestDetail,
  type SpaceRef,
} from "./api.ts";
import { ErrorView } from "./error-view.tsx";
import { appHref, Link } from "./navigation.tsx";
import { useAction } from "./use-load.ts";

/** The word for each status, the same in tags, lists and filters. */
export const STATUS_LABELS: Readonly<Record<ChangeRequestStatus, string>> = {
  draft: "Draft",
  open: "In review",
  merged: "Merged",
  closed: "Closed",
};

/** When something happened, in the host's wording, with the exact time on hover. */
export function When(props: { readonly at: number }) {
  return (
    <time
      dateTime={new Date(props.at).toISOString()}
      title={fullTime(props.at)}
    >
      {relativeTime(props.at)}
    </time>
  );
}

export function isActive(changeRequest: ChangeRequest): boolean {
  return changeRequest.status === "draft" || changeRequest.status === "open";
}

const TAG_CLASSES: Readonly<Record<ChangeRequestStatus, string>> = {
  draft: "is-muted",
  open: "",
  merged: "is-solid",
  closed: "is-muted",
};

export function StatusBadge(props: { readonly status: ChangeRequestStatus }) {
  return (
    <span
      className={`tag cr-status cr-status-${props.status} ${TAG_CLASSES[props.status]}`}
    >
      {STATUS_LABELS[props.status]}
    </span>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Why merging is not possible now, or `undefined` when it is. */
export function mergeBlocker(detail: ChangeRequestDetail): string | undefined {
  const { changeRequest, state } = detail;
  if (state.conflicts > 0) {
    return `${plural(state.conflicts, "conflict")} with main must be resolved first.`;
  }
  if (state.canMerge) return undefined;
  if (state.requiredApprovals > 0 && changeRequest.status === "draft") {
    return "Request a review first.";
  }
  if (changeRequest.approvals.length < state.requiredApprovals) {
    return `Needs ${changeRequest.approvals.length} of ${state.requiredApprovals} approvals.`;
  }
  const blocking = state.checks.filter(
    (check) => check.isRequired && check.status !== "success",
  );
  const failed = blocking.filter((check) => check.status === "failure");
  if (failed.length > 0) {
    return `Required checks failed: ${failed.map((check) => check.title).join(", ")}.`;
  }
  if (blocking.length > 0) {
    return `Waiting for required checks: ${blocking.map((check) => check.title).join(", ")}.`;
  }
  return "You cannot merge this change request.";
}

export interface ActionsProps {
  readonly api: Api;
  readonly space: SpaceRef;
  readonly detail: ChangeRequestDetail;
  readonly userId: string | undefined;
  /** After an action that changed the change request. */
  onChange(): void;
  /** After the branch was updated from main. */
  onRebased(): void;
  /** After a merge or close: the branch is gone. */
  onFinished(): void;
}

/** The buttons the change request's state allows for the caller. */
export function ChangeRequestActions(props: ActionsProps) {
  const { api, space, detail, userId } = props;
  const { changeRequest, state } = detail;
  const { number } = changeRequest;
  const action = useAction();
  if (!isActive(changeRequest)) return null;

  const post = (path: string, method = "POST") =>
    api.call<unknown>(method, `${crPath(space, number)}/${path}`);
  const run = (
    name: string,
    call: () => Promise<unknown>,
    after: () => void,
  ) => {
    void action.run(name, async () => {
      await call();
      after();
    });
  };

  const hasApproved = changeRequest.approvals.some(
    (approval) => approval.userId === userId,
  );
  const blocker = mergeBlocker(detail);
  const blockerId = `cr-merge-blocker-${number}`;
  const isBusy = action.pending !== undefined;
  const canRequestReview = changeRequest.status === "draft" && state.canEdit;
  const canApprove =
    changeRequest.status === "open" && !hasApproved && state.canApprove;
  // One filled button: the step that moves the change request on.
  const primary =
    blocker === undefined
      ? "merge"
      : state.conflicts > 0
        ? "conflicts"
        : canApprove
          ? "approve"
          : canRequestReview
            ? "review"
            : undefined;
  const kind = (name: string) => `btn${primary === name ? " is-primary" : ""}`;

  return (
    <div className="cr-actions" aria-busy={isBusy}>
      {/* Every button is a .btn; the merge, when it can run, is the primary. */}
      {canRequestReview && (
        <button
          type="button"
          className={kind("review")}
          disabled={isBusy}
          onClick={() =>
            run("review", () => post("request-review"), props.onChange)
          }
        >
          Request review
        </button>
      )}
      {changeRequest.status === "open" && hasApproved && (
        <button
          type="button"
          className="btn is-quiet"
          disabled={isBusy}
          onClick={() =>
            run("withdraw", () => post("approve", "DELETE"), props.onChange)
          }
        >
          Withdraw approval
        </button>
      )}
      {canApprove && (
        <button
          type="button"
          className={kind("approve")}
          disabled={isBusy}
          onClick={() => run("approve", () => post("approve"), props.onChange)}
        >
          Approve
        </button>
      )}
      {state.conflicts > 0 ? (
        <Link
          className={kind("conflicts")}
          href={appHref(space, number, "conflicts")}
        >
          Resolve conflicts
        </Link>
      ) : (
        state.isBehind && (
          <button
            type="button"
            className="btn is-quiet"
            disabled={isBusy}
            onClick={() => run("rebase", () => post("rebase"), props.onRebased)}
          >
            Update from main
          </button>
        )
      )}
      <button
        type="button"
        className={kind("merge")}
        disabled={isBusy || blocker !== undefined}
        aria-describedby={blocker === undefined ? undefined : blockerId}
        onClick={() => run("merge", () => post("merge"), props.onFinished)}
      >
        Merge
      </button>
      {state.canEdit && (
        <button
          type="button"
          className="btn is-quiet"
          disabled={isBusy}
          onClick={() => {
            if (
              window.confirm(
                `Close change request #${number}? Its edits are discarded.`,
              )
            ) {
              run("close", () => post("close"), props.onFinished);
            }
          }}
        >
          Close
        </button>
      )}
      {blocker !== undefined && (
        <span id={blockerId} className="notice">
          {blocker}
        </span>
      )}
      {action.error !== undefined && <ErrorView error={action.error} />}
    </div>
  );
}
